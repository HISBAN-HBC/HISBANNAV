// aim-core.js — منطق تسجيل نافذة تصويب واحدة. دالة نقية (بلا DOM) حتى تُختبر.
// قاعدة: كل عينة تُسجَّل خاماً، حتى لو رُفضت النافذة. الرفض دليل أيضاً.
import { addRawReading, addMeasurement, addResult, toSessionEstimate } from "../research/index.js";
import { runNavigation } from "../pipeline/index.js";
import { aggregateAim, toRawImuRecord } from "../sensors/index.js";

const MESSAGES = {
  TOO_FEW_SAMPLES: "عينات غير كافية في النافذة. أعد القياس.",
  PHONE_MOVING: "ثبّت الهاتف وأعد القياس.",
  NON_MONOTONIC_TIME: "زمن العينات غير صالح. أعد القياس.",
  NO_SAMPLES: "لا توجد عينات وضعية. تأكد من تشغيل الحساسات.",
};

/**
 * @returns {{session, outcome}} outcome: { ok, reason?, message?, measurementCount?, result? }
 */
export function recordAimWindow(session, samples) {
  let s = session;
  if (!samples.length) return { session: s, outcome: { ok: false, reason: "NO_SAMPLES", message: MESSAGES.NO_SAMPLES } };

  const idxs = samples.map((smp) => {
    s = addRawReading(s, "imu", toRawImuRecord(smp));
    return s.rawSensors.imu.length - 1;
  });

  const agg = aggregateAim(samples, s.algorithmConfig, { offsetQuaternion: s.calibration.offsetQuaternion });
  if (!agg.ok) {
    return { session: s, outcome: { ok: false, reason: agg.reason, message: MESSAGES[agg.reason] ?? "تعذّر القياس. أعد المحاولة." } };
  }

  s = addMeasurement(s, {
    timestampUtc: samples[0].timestampUtc,
    method: "BORESIGHT",
    solarAltitudeDeg: agg.solarAltitudeDeg,
    solarAzimuthDeg: agg.solarAzimuthDeg,
    sigmaAltitudeDeg: agg.sigmaAltitudeDeg,
    sigmaAzimuthDeg: agg.sigmaAzimuthDeg,
    compassHeadingDeg: null,
    sensorQuality: "UNKNOWN",
  }, { imu: idxs });

  const result = runNavigation(s.measurements, s.algorithmConfig);
  if (result.status === "OK") s = addResult(s, toSessionEstimate(result));
  return { session: s, outcome: { ok: true, measurementCount: s.measurements.length, result } };
}
