// mock-scenario.js — يولّد قراءات حساسات وهمية من الشمس الحقيقية (engine)، ثم يمرّرها عبر
// مزوِّدات Mock وassembleSolarMeasurement. بيانات تجريبية بلا ضوضاء، ومعلَن ذلك في الواجهة.
import { solarPosition } from "../engine/hisban-engine.js";
import { MockClockProvider, MockCompassProvider, MockImuProvider, assembleSolarMeasurement, unavailable } from "../sensors/index.js";

const norm360 = (d) => ((d % 360) + 360) % 360;

/**
 * @returns {{ measurements, sourceIndexes, raw, skipped }}
 * bias ثابت + انحراف خطي (درجة/ساعة). dropAt: فهرس قراءة بوصلة تُفقد عمداً (لاختبار المسار غير المتاح).
 */
export function buildMockStream({ lat, lon, startUtcMs, count = 6, stepMin = 20, compassBiasDeg = 4, driftDegPerHour = 0, dropAt = null }) {
  const clockP = new MockClockProvider({ startUtcMs, stepMs: stepMin * 60_000 });
  const imuScript = [];
  const compassScript = [];
  for (let i = 0; i < count; i++) {
    const t = startUtcMs + i * stepMin * 60_000;
    const iso = new Date(t).toISOString();
    const p = solarPosition(t, lat, lon);
    imuScript.push({
      timestampUtc: iso, sunAltitudeDeg: p.altitudeDeg, sigmaDeg: 1, available: true,
      // قيم خام وهمية (MOCK): لا تمثل حركة هاتف حقيقية
      accelerometer: { x: 0, y: 0, z: 9.81 }, gyroscope: { x: 0, y: 0, z: 0 }, magnetometer: { x: 0, y: 0, z: 0 },
      orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    });
    const bias = compassBiasDeg + (driftDegPerHour * (i * stepMin)) / 60;
    compassScript.push(
      i === dropAt
        ? unavailable("SENSOR_BUSY", iso)
        : { timestampUtc: iso, headingDeg: norm360(p.azimuthDeg + bias), sigmaDeg: 3, calibrationState: "GOOD", magneticFieldMagnitude: null, available: true },
    );
  }
  const clock = clockP;
  const imu = new MockImuProvider(imuScript);
  const compass = new MockCompassProvider(compassScript);
  const measurements = [];
  const sourceIndexes = [];
  const skipped = [];
  const raw = { compass: [], imu: [], gnss: [], clock: [] };
  for (let i = 0; i < count; i++) {
    const c = clock.read(), im = imu.read(), co = compass.read();
    raw.clock.push(c); raw.imu.push(im); raw.compass.push(co);
    const r = assembleSolarMeasurement({ clock: c, imu: im, compass: co, sunRelativeBearingDeg: 0 });
    if (r.ok) {
      // قراءات الخام تُسجَّل كلها (بما فيها غير المتاحة)، فالفهرس هنا هو i
      measurements.push(r.measurement);
      sourceIndexes.push({ compass: i, imu: i, gnss: null });
    } else skipped.push({ index: i, reason: r.missing ? `${r.reason}: ${r.missing.join(", ")}` : r.reason });
  }
  return { measurements, sourceIndexes, raw, skipped };
}
