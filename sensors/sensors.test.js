import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import { DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { createSession, addMeasurement, serializeSession, parseSession } from "../research/index.js";
import {
  MockCompassProvider, MockImuProvider, MockGnssProvider, MockClockProvider, ReplaySolarProvider,
  assembleSolarMeasurement, validateCompassReading,
  validateGnssReading, unavailable,
} from "./index.js";

const T0 = "2026-11-10T07:00:00.000Z";

test("compass contract rejects heading outside [0,360) and non-positive sigma", () => {
  assert.ok(validateCompassReading({ timestampUtc: T0, headingDeg: 360, sigmaDeg: 3, calibrationState: "GOOD", available: true }).length > 0);
  assert.ok(validateCompassReading({ timestampUtc: T0, headingDeg: 10, sigmaDeg: 0, calibrationState: "GOOD", available: true }).length > 0);
  assert.deepEqual(validateCompassReading({ timestampUtc: T0, headingDeg: 10, sigmaDeg: 3, calibrationState: "GOOD", available: true }), []);
});

test("gnss contract requires accuracy and bounded coordinates", () => {
  assert.ok(validateGnssReading({ timestampUtc: T0, latitudeDeg: 95, longitudeDeg: 0, accuracyM: 5, available: true }).length > 0);
  assert.ok(validateGnssReading({ timestampUtc: T0, latitudeDeg: 1, longitudeDeg: 0, accuracyM: 0, available: true }).length > 0);
});

test("unavailable readings must state a reason", () => {
  assert.deepEqual(validateCompassReading(unavailable("NO_CALIBRATION")), []);
  assert.ok(validateCompassReading({ available: false }).length > 0);
});

test("mock providers return scripted readings in order, then an explicit end", () => {
  const compass = new MockCompassProvider([
    { timestampUtc: T0, headingDeg: 10, sigmaDeg: 3, calibrationState: "GOOD", available: true },
    unavailable("SENSOR_BUSY"),
  ]);
  assert.equal(compass.read().headingDeg, 10);
  assert.equal(compass.read().reason, "SENSOR_BUSY");
  assert.equal(compass.read().reason, "END_OF_SCRIPT");
  compass.reset();
  assert.equal(compass.remaining, 2);
});

test("mock providers refuse invalid scripts at construction", () => {
  assert.throws(() => new MockImuProvider([{ timestampUtc: T0, sunAltitudeDeg: 120, sigmaDeg: 1, available: true }]), /invalid scripted/);
  assert.throws(() => new MockGnssProvider([{ timestampUtc: "nope", latitudeDeg: 0, longitudeDeg: 0, accuracyM: 5, available: true }]), /invalid scripted/);
});

test("mock clock advances deterministically", () => {
  const clock = new MockClockProvider({ startUtcMs: Date.parse(T0), stepMs: 60_000 });
  assert.equal(clock.read().timestampUtc, T0);
  assert.equal(clock.read().timestampUtc, "2026-11-10T07:01:00.000Z");
});


test("assembly wraps azimuth through north and maps calibration to quality", () => {
  const r = assembleSolarMeasurement({
    clock: { timestampUtc: T0, source: "MOCK", available: true },
    imu: { timestampUtc: T0, sunAltitudeDeg: 30, sigmaDeg: 1, available: true },
    compass: { timestampUtc: T0, headingDeg: 358, sigmaDeg: 3, calibrationState: "FAIR", available: true },
    sunRelativeBearingDeg: 4,
  });
  assert.equal(r.ok, true);
  assert.equal(r.measurement.solarAzimuthDeg, 2);
  assert.equal(r.measurement.sensorQuality, "FAIR");
  assert.equal(r.measurement.sigmaAzimuthDeg, 3);
});

test("assembly refuses when a sensor is unavailable, and names it", () => {
  const r = assembleSolarMeasurement({
    clock: { timestampUtc: T0, source: "MOCK", available: true },
    imu: unavailable("IMU_OFF"),
    compass: { timestampUtc: T0, headingDeg: 10, sigmaDeg: 3, calibrationState: "GOOD", available: true },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["imu"]);
});

test("assembly refuses readings that are more than a second apart", () => {
  const r = assembleSolarMeasurement({
    clock: { timestampUtc: T0, source: "MOCK", available: true },
    imu: { timestampUtc: T0, sunAltitudeDeg: 30, sigmaDeg: 1, available: true },
    compass: { timestampUtc: "2026-11-10T07:00:05.000Z", headingDeg: 10, sigmaDeg: 3, calibrationState: "GOOD", available: true },
  });
  assert.equal(r.reason, "TIME_SKEW");
});

function recordedSession() {
  const base = Date.UTC(2026, 10, 10, 7);
  let s = createSession({
    sessionId: "REPLAY-1", appVersion: "0.1.0", algorithmVersion: "2026.11",
    algorithmConfig: DEFAULT_ALGORITHM_CONFIG, startedAtUtc: T0,
  });
  for (let i = 0; i < 4; i++) {
    const t = new Date(base + i * 120_000);
    const p = solarPosition(t.getTime(), 36.75, 3.04);
    s = addMeasurement(s, {
      timestampUtc: t.toISOString(), solarAltitudeDeg: p.altitudeDeg, solarAzimuthDeg: (p.azimuthDeg + 5) % 360,
      sigmaAltitudeDeg: 1, sigmaAzimuthDeg: 3, compassHeadingDeg: null, sensorQuality: "GOOD",
    });
  }
  return s;
}

test("replay provider yields the recorded measurements in the same order", () => {
  const s = parseSession(serializeSession(recordedSession()));
  const rp = new ReplaySolarProvider(s);
  const seen = [];
  for (let r = rp.read(); r.available; r = rp.read()) seen.push(r.measurement);
  assert.deepEqual(seen, s.measurements);
  assert.equal(rp.read().reason, "END_OF_SESSION");
  rp.reset();
  assert.equal(rp.position, 0);
  assert.equal(rp.read().measurement.timestampUtc, s.measurements[0].timestampUtc);
});

test("replay provider rejects something that is not a session", () => {
  assert.throws(() => new ReplaySolarProvider({}), /measurements must be an array/);
});
