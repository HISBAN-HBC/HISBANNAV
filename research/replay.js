// replay.js — إعادة تشغيل الجلسة على مستويين:
//   measurement: يعيد تشغيل الخط على القياسات المجمّعة المسجَّلة.
//   raw:         يعيد بناء القياسات من القراءات الخام (عبر sourceSensorIndexes) ثم يتحقق منها،
//                ثم يعيد تشغيل الخط. هذا هو الاختبار الحقيقي لأي جلسة هاتف.
// أي اختلاف يعني أن الجلسة غير قابلة لإعادة الإنتاج.

import { runNavigation, toInternal as toInternalMeasurements, DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { assembleSolarMeasurement, aggregateAim } from "../sensors/index.js";
import { RAW_STREAMS } from "./raw.js";

/** القياسات بالصيغة الداخلية للمُقدِّر. */
export function toInternal(session) {
  return toInternalMeasurements(session.measurements);
}

/** يحوّل نتيجة خط الأنابيب إلى حقول النتيجة المسجَّلة. */
export function toSessionEstimate(result) {
  return {
    latitudeDeg: result.estimate.latitudeDeg,
    longitudeDeg: result.estimate.longitudeDeg,
    biasDeg: result.estimate.biasDeg,
    chiSquare: result.diagnostics.chiSquare,
    uncertaintyKm: result.uncertainty.positionKm,
    navigationState: result.navigationState,
    sensorState: result.sensorState,
  };
}

/** آخر نتيجة مسجَّلة: v2 من results، و v1 من estimate. */
export function recordedEstimate(session) {
  if (session.schemaVersion === 1) {
    return session.estimate ? { ...session.estimate, measurementCount: session.measurements.length } : null;
  }
  return session.results.length ? session.results[session.results.length - 1] : null;
}

export function hasRawSensors(session) {
  return session.schemaVersion === 2 && RAW_STREAMS.some((k) => session.rawSensors[k].length > 0);
}

/**
 * يعيد بناء القياسات المجمّعة من القراءات الخام. ترجع { ok, measurements } أو { ok:false, reason }.
 * الطابع الزمني للقياس هو المسجَّل نفسه (ساعة مرجعية)، والزاوية النسبية للشمس ثابتة 0 كما في التسجيل.
 */
export function rebuildMeasurements(session) {
  const out = [];
  for (let i = 0; i < session.measurements.length; i++) {
    const m = session.measurements[i];
    const idx = m.sourceSensorIndexes;
    if (m.method === "BORESIGHT") {
      const b = rebuildBoresight(session, m, idx, i);
      if (!b.ok) return b;
      out.push(b.measurement);
      continue;
    }
    if (!idx || idx.compass === null || idx.compass === undefined || idx.imu === null || idx.imu === undefined) {
      return { ok: false, reason: `measurement ${i} has no compass/imu source indexes` };
    }
    const r = assembleSolarMeasurement({
      clock: { timestampUtc: m.timestampUtc, source: "RECORDED", available: true },
      imu: session.rawSensors.imu[idx.imu],
      compass: session.rawSensors.compass[idx.compass],
      sunRelativeBearingDeg: 0,
    });
    if (!r.ok) return { ok: false, reason: `measurement ${i}: ${r.reason}` };
    out.push(r.measurement);
  }
  return { ok: true, measurements: out };
}

const MEASUREMENT_FIELDS = ["timestampUtc", "method", "solarAltitudeDeg", "solarAzimuthDeg", "sigmaAltitudeDeg", "sigmaAzimuthDeg", "compassHeadingDeg", "sensorQuality"];

/**
 * يعيد بناء قياس التصويب من نافذة عينات الوضعية المخزَّنة، بالمعايرة المسجَّلة وإعدادات الجلسة.
 * الحركة داخل النافذة تُرفض هنا أيضاً، كما في التسجيل.
 */
function rebuildBoresight(session, m, idx, i) {
  if (!idx || !Array.isArray(idx.imu) || idx.imu.length === 0) return { ok: false, reason: `measurement ${i} has no imu window` };
  const samples = [];
  for (const j of idx.imu) {
    const raw = session.rawSensors.imu[j];
    if (!raw || !raw.available || !raw.orientation?.quaternion) return { ok: false, reason: `measurement ${i}: imu[${j}] has no quaternion` };
    samples.push({ timestampUtc: raw.timestampUtc, quaternion: raw.orientation.quaternion });
  }
  const agg = aggregateAim(samples, session.algorithmConfig, { offsetQuaternion: session.calibration?.offsetQuaternion });
  if (!agg.ok) return { ok: false, reason: `measurement ${i}: ${agg.reason}` };
  return {
    ok: true,
    measurement: {
      timestampUtc: m.timestampUtc,
      solarAltitudeDeg: agg.solarAltitudeDeg,
      solarAzimuthDeg: agg.solarAzimuthDeg,
      sigmaAltitudeDeg: agg.sigmaAltitudeDeg,
      sigmaAzimuthDeg: agg.sigmaAzimuthDeg,
      compassHeadingDeg: null,
      sensorQuality: "UNKNOWN",
      method: "BORESIGHT",
    },
  };
}

/** مقارنة القياسات المعاد بناؤها بما استُهلك فعلياً. */
export function compareMeasurements(recorded, rebuilt, tol = 1e-9) {
  const diffs = [];
  if (recorded.length !== rebuilt.length) return [`count ${rebuilt.length} vs recorded ${recorded.length}`];
  recorded.forEach((a, i) => {
    for (const f of MEASUREMENT_FIELDS) {
      const x = a[f], y = rebuilt[i][f];
      const same = typeof x === "number" && typeof y === "number" ? Math.abs(x - y) <= tol : x === y;
      if (!same) diffs.push(`measurement ${i} ${f}: rebuilt ${y} vs recorded ${x}`);
    }
  });
  return diffs;
}

/**
 * يعيد التشغيل. level: "auto" (raw إن وُجدت قراءات خام، وإلا measurement) | "measurement" | "raw".
 */
export function replaySession(session, { tolDeg = 1e-6, tolBiasDeg = 1e-5, tolChi2Rel = 1e-9, level = "auto" } = {}) {
  const effective = level === "auto" ? (hasRawSensors(session) ? "raw" : "measurement") : level;
  let measurements = session.measurements;

  if (effective === "raw") {
    if (!hasRawSensors(session)) return { reproducible: null, level, reason: "no raw sensor records" };
    const rebuilt = rebuildMeasurements(session);
    if (!rebuilt.ok) return { reproducible: false, level, diffs: [`rebuild failed: ${rebuilt.reason}`] };
    const mismatch = compareMeasurements(session.measurements, rebuilt.measurements);
    if (mismatch.length) return { reproducible: false, level, diffs: mismatch };
    measurements = rebuilt.measurements;
  }

  const result = runNavigation(measurements, session.algorithmConfig ?? DEFAULT_ALGORITHM_CONFIG);
  if (result.status !== "OK") return { reproducible: null, level: effective, reason: `pipeline ${result.status}`, recomputed: result };
  const rec = recordedEstimate(session);
  if (!rec) return { reproducible: null, level: effective, reason: "no recorded estimate", recomputed: result };
  if (rec.measurementCount !== session.measurements.length) {
    return { reproducible: null, level: effective, reason: "recorded result is not for the final measurement", recomputed: result };
  }

  const again = toSessionEstimate(result);
  const diffs = [];
  if (Math.abs(again.latitudeDeg - rec.latitudeDeg) > tolDeg) diffs.push(`latitude ${again.latitudeDeg} vs ${rec.latitudeDeg}`);
  if (Math.abs(again.longitudeDeg - rec.longitudeDeg) > tolDeg) diffs.push(`longitude`);
  if (Math.abs(again.biasDeg - rec.biasDeg) > tolBiasDeg) diffs.push(`bias`);
  if (Math.abs(again.chiSquare - rec.chiSquare) > Math.max(1e-9, tolChi2Rel * Math.abs(rec.chiSquare))) diffs.push(`chiSquare`);
  if (again.navigationState !== rec.navigationState) diffs.push(`navigationState ${again.navigationState} vs ${rec.navigationState}`);
  if (again.sensorState !== rec.sensorState) diffs.push(`sensorState ${again.sensorState} vs ${rec.sensorState}`);
  return { reproducible: diffs.length === 0, level: effective, diffs, recomputed: result };
}
