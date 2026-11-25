// validate.js — التحقق من القياسات والإعدادات قبل أي حساب.
import { DEFAULT_ALGORITHM_CONFIG, SENSOR_QUALITY } from "./config.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isPos = (x) => isNum(x) && x > 0;

/** يتحقق من قياس واحد بصيغة الشمس؛ يعيد قائمة أخطاء (فارغة إن كان صالحاً). */
export function validateMeasurement(m) {
  const e = [];
  if (typeof m.timestampUtc !== "string" || Number.isNaN(Date.parse(m.timestampUtc))) e.push("timestampUtc must be an ISO-8601 string");
  if (!isNum(m.solarAltitudeDeg) || m.solarAltitudeDeg < -90 || m.solarAltitudeDeg > 90) e.push("solarAltitudeDeg must be in [-90, 90]");
  if (!isNum(m.solarAzimuthDeg) || m.solarAzimuthDeg < 0 || m.solarAzimuthDeg >= 360) e.push("solarAzimuthDeg must be in [0, 360)");
  if (!isPos(m.sigmaAltitudeDeg)) e.push("sigmaAltitudeDeg is required (> 0)");
  if (!isPos(m.sigmaAzimuthDeg)) e.push("sigmaAzimuthDeg is required (> 0)");
  if (m.compassHeadingDeg !== null && m.compassHeadingDeg !== undefined && !(isNum(m.compassHeadingDeg) && m.compassHeadingDeg >= 0 && m.compassHeadingDeg < 360)) {
    e.push("compassHeadingDeg must be null or in [0, 360)");
  }
  if (!SENSOR_QUALITY.includes(m.sensorQuality)) e.push(`sensorQuality must be one of ${SENSOR_QUALITY.join(", ")}`);
  return e;
}

/** يتحقق من الإعدادات الخوارزمية: كل مفتاح موجود وقيمته رقمية. */
export function validateAlgorithmConfig(c) {
  const e = [];
  for (const key of Object.keys(DEFAULT_ALGORITHM_CONFIG)) {
    if (!isNum(c?.[key])) e.push(`algorithmConfig.${key} is required (number)`);
  }
  return e;
}
