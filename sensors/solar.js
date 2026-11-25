// solar.js — تجميع قراءات الحساسات (ساعة، IMU، بوصلة) في قياس شمس واحد بصيغة السجل.
// الافتراض الهندسي صريح: سمت الشمس = سمت البوصلة + الزاوية النسبية للشمس (sunRelativeBearingDeg).
// ارتفاع الشمس يأتي من IMU بعد اشتقاقه من إجراء التوجيه؛ إن لم يُشتق يُرفض القياس بسبب صريح.

const QUALITY = { GOOD: "GOOD", FAIR: "FAIR", POOR: "POOR", UNKNOWN: "UNKNOWN" };

export function assembleSolarMeasurement({ clock, imu, compass, sunRelativeBearingDeg = 0, maxSkewMs = 1000 }) {
  const missing = [];
  if (!clock?.available) missing.push("clock");
  if (!imu?.available) missing.push("imu");
  if (!compass?.available) missing.push("compass");
  if (missing.length) return { ok: false, reason: "SENSOR_UNAVAILABLE", missing };
  if (typeof imu.sunAltitudeDeg !== "number" || typeof imu.sigmaDeg !== "number") {
    return { ok: false, reason: "SUN_ALTITUDE_NOT_DERIVED", missing: ["imu.sunAltitudeDeg"] };
  }

  const t = Date.parse(clock.timestampUtc);
  const skew = Math.max(Math.abs(t - Date.parse(imu.timestampUtc)), Math.abs(t - Date.parse(compass.timestampUtc)));
  if (skew > maxSkewMs) return { ok: false, reason: "TIME_SKEW", skewMs: skew };

  return {
    ok: true,
    measurement: {
      timestampUtc: clock.timestampUtc,
      solarAltitudeDeg: imu.sunAltitudeDeg,
      solarAzimuthDeg: (((compass.headingDeg + sunRelativeBearingDeg) % 360) + 360) % 360,
      sigmaAltitudeDeg: imu.sigmaDeg,
      sigmaAzimuthDeg: compass.sigmaDeg,
      compassHeadingDeg: compass.headingDeg,
      sensorQuality: QUALITY[compass.calibrationState] ?? "UNKNOWN",
    },
  };
}
