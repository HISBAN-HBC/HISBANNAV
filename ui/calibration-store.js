// calibration-store.js — حفظ المعايرة محلياً مع تاريخها ونوع الجهاز. storage يُحقن (localStorage في المتصفح).
import { IDENTITY_QUATERNION } from "../sensors/index.js";

export const STORAGE_KEY = "hisban.calibration.v1";

export function saveCalibration(storage, record) {
  storage.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** يعيد المعايرة إن وُجدت وسليمة. إن كان الجهاز مختلفاً يعيدها مع علامة mismatch، ولا يخفيها. */
export function loadCalibration(storage, { userAgent = null } = {}) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let rec;
  try { rec = JSON.parse(raw); } catch { return null; }
  const q = rec?.offsetQuaternion;
  if (!q || ![q.w, q.x, q.y, q.z].every(Number.isFinite)) return null;
  return { ...rec, deviceMismatch: userAgent !== null && rec.device?.userAgent !== userAgent };
}

/** الإزاحة الفعلية للجلسة: من المعايرة إن وُجدت، وإلا صفر. */
export function offsetFor(record) {
  return record ? { ...record.offsetQuaternion } : { ...IDENTITY_QUATERNION };
}
