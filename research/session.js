// session.js — جلسة قياس قابلة لإعادة التشغيل (الإصدار 2). كل تعديل يعيد نسخة جديدة (لا تعديل في المكان).

import { CURRENT_SCHEMA_VERSION, validateMeasurement, validateAlgorithmConfig } from "./schema.js";
import { RAW_STREAMS, validateRawRecord, emptyRawSensors, checkSourceIndexes } from "./raw.js";

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

function normalizeDevice(device) {
  const d = device ?? { platform: "UNSPECIFIED" };
  if (typeof d.platform !== "string" || !d.platform) throw new Error("research: device.platform is required");
  return {
    platform: d.platform,
    model: d.model ?? null,
    osVersion: d.osVersion ?? null,
    sensorCapabilities: Array.isArray(d.sensorCapabilities) ? [...d.sensorCapabilities] : [],
  };
}

/** معايرة الإزاحة بين محور الجهاز ومحور الكاميرا؛ الافتراضي: بلا إزاحة. */
export function normalizeCalibration(calibration) {
  const q = calibration?.offsetQuaternion ?? IDENTITY;
  for (const k of ["w", "x", "y", "z"]) {
    if (!Number.isFinite(q[k])) throw new Error(`research: calibration.offsetQuaternion.${k} must be a number`);
  }
  return { offsetQuaternion: { w: q.w, x: q.x, y: q.y, z: q.z } };
}

export function createSession({ sessionId, appVersion, algorithmVersion, algorithmConfig, startedAtUtc, device, calibration }) {
  const cfgErrors = validateAlgorithmConfig(algorithmConfig);
  if (cfgErrors.length) throw new Error(`research: ${cfgErrors.join("; ")}`);
  if (typeof sessionId !== "string" || !sessionId) throw new Error("research: sessionId is required");
  return Object.freeze({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessionId,
    appVersion: String(appVersion),
    algorithmVersion: String(algorithmVersion),
    algorithmConfig: { ...algorithmConfig },
    startedAtUtc: startedAtUtc ?? new Date().toISOString(),
    device: normalizeDevice(device),
    calibration: normalizeCalibration(calibration),
    rawSensors: emptyRawSensors(),
    measurements: [],
    results: [],
    truth: null,
  });
}

/** يضيف قراءة خام إلى تدفق. الفهرس الناتج هو (طول التدفق − 1) بعد الإضافة. */
export function addRawReading(session, stream, reading) {
  if (!RAW_STREAMS.includes(stream)) throw new Error(`research: unknown raw stream ${stream}`);
  const errors = validateRawRecord(stream, reading);
  if (errors.length) throw new Error(`research: invalid ${stream} reading: ${errors.join("; ")}`);
  const rawSensors = { ...session.rawSensors, [stream]: [...session.rawSensors[stream], Object.freeze({ ...reading })] };
  return Object.freeze({ ...session, rawSensors: Object.freeze(rawSensors) });
}

/**
 * يضيف قياساً مجمّعاً. sourceSensorIndexes اختياري:
 *   { compass, imu, gnss } ; imu يمكن أن تكون نافذة (مصفوفة) لقياس التصويب.
 */
export function addMeasurement(session, m, sourceSensorIndexes = null) {
  const errors = validateMeasurement(m);
  if (errors.length) throw new Error(`research: invalid measurement: ${errors.join("; ")}`);
  const idxErrors = checkSourceIndexes(session, sourceSensorIndexes);
  if (idxErrors.length) throw new Error(`research: ${idxErrors.join("; ")}`);
  const stored = { ...m, sourceSensorIndexes: sourceSensorIndexes ? { compass: null, imu: null, gnss: null, ...sourceSensorIndexes } : null };
  return Object.freeze({ ...session, measurements: [...session.measurements, stored] });
}

/** يضيف نتيجة تشغيل للخط، مرتبطة بعدد القياسات الحالي. */
export function addResult(session, est) {
  const required = ["latitudeDeg", "longitudeDeg", "biasDeg", "chiSquare", "uncertaintyKm", "navigationState", "sensorState"];
  for (const k of required) if (est[k] === undefined) throw new Error(`research: result.${k} is required`);
  const entry = { measurementCount: session.measurements.length, ...est };
  return Object.freeze({ ...session, results: [...session.results, entry] });
}

export function setTruth(session, truth) {
  for (const k of ["gnssLatitudeDeg", "gnssLongitudeDeg", "accuracyM"]) {
    if (!(typeof truth[k] === "number" && Number.isFinite(truth[k]))) throw new Error(`research: truth.${k} must be a number`);
  }
  return Object.freeze({ ...session, truth: { ...truth } });
}
