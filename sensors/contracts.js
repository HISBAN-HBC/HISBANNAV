// contracts.js — عقود القراءات الموحدة لكل حساس. لا تعرف هذه الوحدة شيئاً عن estimator.
// كل قراءة إما متاحة (available: true) بحقولها، أو غير متاحة (available: false) بسبب صريح.
// الغير متاح يُسجَّل أيضاً في الجلسة، لأن الانقطاعات جزء من الدليل.

export const CALIBRATION_STATES = Object.freeze(["GOOD", "FAIR", "POOR", "UNKNOWN"]);

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const isOptNum = (x, ok) => x === null || x === undefined || (isNum(x) && ok(x));
const vec3 = (v) => v && isNum(v.x) && isNum(v.y) && isNum(v.z);

/** قراءة غير متاحة، مع سبب صريح. */
export function unavailable(reason, timestampUtc = null) {
  return { timestampUtc, available: false, reason };
}

function unavailableOk(r) {
  return r.reason ? [] : ["unavailable reading needs a reason"];
}

/**
 * { timestampUtc, headingDeg, sigmaDeg, calibrationState, magneticFieldMagnitude, available }
 * magneticFieldMagnitude اختياري (μT)، وقد لا يوفره كل هاتف.
 */
export function validateCompassReading(r) {
  if (r.available === false) return unavailableOk(r);
  const e = [];
  if (!isIso(r.timestampUtc)) e.push("timestampUtc must be ISO-8601");
  if (!isNum(r.headingDeg) || r.headingDeg < 0 || r.headingDeg >= 360) e.push("headingDeg must be in [0, 360)");
  if (!isNum(r.sigmaDeg) || r.sigmaDeg <= 0) e.push("sigmaDeg must be > 0");
  if (!CALIBRATION_STATES.includes(r.calibrationState)) e.push(`calibrationState must be one of ${CALIBRATION_STATES.join(", ")}`);
  if (!isOptNum(r.magneticFieldMagnitude, (x) => x >= 0)) e.push("magneticFieldMagnitude must be null or >= 0");
  return e;
}

/**
 * قراءة IMU خام: orientation (quaternion أو زوايا أويلر) مطلوبة حين available، والحساسات الأخرى قد تكون null.
 * sunAltitudeDeg و sigmaDeg مشتقان من إجراء توجيه الشمس، وهما اختياريان (null إن لم يُشتقا).
 */
export function validateImuReading(r) {
  if (r.available === false) return unavailableOk(r);
  const e = [];
  if (!isIso(r.timestampUtc)) e.push("timestampUtc must be ISO-8601");
  // الحساسات التي لا يوفرها الهاتف تُسجَّل null صراحة، لا تُحذف.
  if (r.accelerometer !== null && !vec3(r.accelerometer)) e.push("accelerometer must be null or {x,y,z}");
  if (r.gyroscope !== null && !vec3(r.gyroscope)) e.push("gyroscope must be null or {x,y,z}");
  if (r.magnetometer !== null && !vec3(r.magnetometer)) e.push("magnetometer must be null or {x,y,z}");
  const o = r.orientation;
  const hasQ = o && o.quaternion && isNum(o.quaternion.w) && isNum(o.quaternion.x) && isNum(o.quaternion.y) && isNum(o.quaternion.z)
    && Math.hypot(o.quaternion.w, o.quaternion.x, o.quaternion.y, o.quaternion.z) > 0;
  const hasE = o && isNum(o.yawDeg) && isNum(o.pitchDeg) && isNum(o.rollDeg);
  if (!hasQ && !hasE) e.push("orientation needs a quaternion {w,x,y,z} or {yawDeg,pitchDeg,rollDeg}");
  if (!isOptNum(r.sunAltitudeDeg, (x) => x >= -90 && x <= 90)) e.push("sunAltitudeDeg must be null or in [-90, 90]");
  if (!isOptNum(r.sigmaDeg, (x) => x > 0)) e.push("sigmaDeg must be null or > 0");
  if (isNum(r.sunAltitudeDeg) && !isNum(r.sigmaDeg)) e.push("sigmaDeg is required when sunAltitudeDeg is derived");
  return e;
}

/**
 * { timestampUtc, latitudeDeg, longitudeDeg, altitudeM, accuracyM, speedMps, bearingDeg, available }
 * الحقول الاختيارية (altitudeM, speedMps, bearingDeg) تُقبل null.
 */
export function validateGnssReading(r) {
  if (r.available === false) return unavailableOk(r);
  const e = [];
  if (!isIso(r.timestampUtc)) e.push("timestampUtc must be ISO-8601");
  if (!isNum(r.latitudeDeg) || r.latitudeDeg < -90 || r.latitudeDeg > 90) e.push("latitudeDeg must be in [-90, 90]");
  if (!isNum(r.longitudeDeg) || r.longitudeDeg < -180 || r.longitudeDeg > 180) e.push("longitudeDeg must be in [-180, 180]");
  if (!isNum(r.accuracyM) || r.accuracyM <= 0) e.push("accuracyM must be > 0");
  if (!isOptNum(r.altitudeM, () => true)) e.push("altitudeM must be null or a number");
  if (!isOptNum(r.speedMps, (x) => x >= 0)) e.push("speedMps must be null or >= 0");
  if (!isOptNum(r.bearingDeg, (x) => x >= 0 && x < 360)) e.push("bearingDeg must be null or in [0, 360)");
  return e;
}

/** { timestampUtc, source, available } */
export function validateClockReading(r) {
  if (r.available === false) return unavailableOk(r);
  const e = [];
  if (!isIso(r.timestampUtc)) e.push("timestampUtc must be ISO-8601");
  if (typeof r.source !== "string" || !r.source) e.push("source is required");
  return e;
}
