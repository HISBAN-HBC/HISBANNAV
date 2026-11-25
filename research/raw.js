// raw.js — تسجيل القراءات الخام للحساسات (v2). كل تدفق قائمة مرتبة، والفهرس هو المرجع من القياس.
import { validateCompassReading, validateImuReading, validateGnssReading, validateClockReading } from "../sensors/contracts.js";

export const RAW_STREAMS = Object.freeze(["compass", "imu", "gnss", "clock"]);
const VALIDATORS = {
  compass: validateCompassReading,
  imu: validateImuReading,
  gnss: validateGnssReading,
  clock: validateClockReading,
};

/** يتحقق من قراءة خام واحدة في تدفق معيّن؛ يعيد قائمة أخطاء. */
export function validateRawRecord(stream, r) {
  if (!VALIDATORS[stream]) return [`unknown raw stream: ${stream}`];
  if (!r || typeof r !== "object") return ["raw reading must be an object"];
  return VALIDATORS[stream](r);
}

export function emptyRawSensors() {
  return { compass: [], imu: [], gnss: [], clock: [] };
}

/**
 * يتحقق من روابط القياس بالقراءات الخام.
 * compass و gnss: فهرس واحد أو null. imu: فهرس واحد أو نافذة (مصفوفة فهارس) لقياس التصويب.
 * يعيد قائمة أخطاء.
 */
export function checkSourceIndexes(session, idx) {
  const errors = [];
  if (!idx) return errors;
  for (const key of ["compass", "imu", "gnss"]) {
    const v = idx[key];
    if (v === null || v === undefined) continue;
    const list = Array.isArray(v) ? v : [v];
    if (Array.isArray(v) && key !== "imu") errors.push(`sourceSensorIndexes.${key} cannot be a window`);
    const len = session.rawSensors?.[key]?.length ?? 0;
    for (const i of list) {
      if (!Number.isInteger(i) || i < 0 || i >= len) errors.push(`sourceSensorIndexes.${key}=${i} is out of range (have ${len})`);
    }
    if (Array.isArray(v) && v.length === 0) errors.push(`sourceSensorIndexes.${key} window is empty`);
  }
  return errors;
}
