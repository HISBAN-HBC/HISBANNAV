import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession, addRawReading, addMeasurement, addResult, serializeSession, parseSession,
  replaySession, toSessionEstimate, recordedEstimate, DEFAULT_ALGORITHM_CONFIG,
} from "./index.js";
import { runNavigation } from "../pipeline/index.js";
import { recordSession } from "../ui/record-session.js";
import { buildMockStream } from "../ui/mock-scenario.js";

const OPTS = { lat: -35, lon: 150, startUtcMs: Date.UTC(2026, 10, 10, 1, 46), count: 6, stepMin: 20, compassBiasDeg: 4 };
const clone = (s) => JSON.parse(serializeSession(s));

test("a new session is schema v2 with raw streams, device and results", () => {
  const s = createSession({ sessionId: "V2", appVersion: "1", algorithmVersion: "1", algorithmConfig: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(s.schemaVersion, 2);
  assert.deepEqual(Object.keys(s.rawSensors).sort(), ["clock", "compass", "gnss", "imu"]);
  assert.equal(s.device.platform, "UNSPECIFIED");
  assert.deepEqual(s.results, []);
});

test("raw readings are validated on entry; an IMU without orientation is refused", () => {
  const s = createSession({ sessionId: "V2", appVersion: "1", algorithmVersion: "1", algorithmConfig: DEFAULT_ALGORITHM_CONFIG });
  assert.throws(() => addRawReading(s, "imu", { timestampUtc: "2026-11-10T01:46:00Z", available: true, accelerometer: { x: 0, y: 0, z: 9.8 }, gyroscope: { x: 0, y: 0, z: 0 }, magnetometer: { x: 0, y: 0, z: 0 } }), /orientation/);
});

test("unavailable raw readings are recorded, not dropped", () => {
  const { session, skipped } = recordSession({ ...OPTS, dropAt: 2 });
  assert.equal(session.rawSensors.compass.length, 6);
  assert.equal(session.rawSensors.compass[2].available, false);
  assert.equal(session.measurements.length, 5);
  assert.equal(skipped.length, 1);
});

test("a measurement cannot point at a raw reading that does not exist", () => {
  const { session } = recordSession(OPTS);
  const m = session.measurements[0];
  assert.throws(() => addMeasurement(session, m, { compass: 99, imu: 0, gnss: null }), /out of range/);
});

test("raw replay rebuilds the measurements exactly and reproduces the result", () => {
  const { session } = recordSession(OPTS);
  const r = replaySession(parseSession(serializeSession(session)), { level: "raw" });
  assert.equal(r.level, "raw");
  assert.equal(r.reproducible, true, JSON.stringify(r.diffs));
});

test("tampering a raw compass heading is caught by raw replay", () => {
  const { session } = recordSession(OPTS);
  const obj = clone(session);
  obj.rawSensors.compass[3].headingDeg = (obj.rawSensors.compass[3].headingDeg + 5) % 360;
  const r = replaySession(parseSession(JSON.stringify(obj)), { level: "raw" });
  assert.equal(r.reproducible, false);
  assert.match(r.diffs[0], /measurement 3 solarAzimuthDeg/);
});

test("a measurement-level replay cannot see a raw-only tamper, which is why raw replay exists", () => {
  const { session } = recordSession(OPTS);
  const obj = clone(session);
  obj.rawSensors.compass[3].headingDeg = (obj.rawSensors.compass[3].headingDeg + 5) % 360;
  const r = replaySession(parseSession(JSON.stringify(obj)), { level: "measurement" });
  assert.equal(r.reproducible, true);
});

test("v2 session without a derived sun altitude reports that it cannot be rebuilt", () => {
  const { session } = recordSession(OPTS);
  const obj = clone(session);
  for (const im of obj.rawSensors.imu) im.sunAltitudeDeg = null;
  const r = replaySession(parseSession(JSON.stringify(obj)), { level: "raw" });
  assert.equal(r.reproducible, false);
  assert.match(r.diffs[0], /SUN_ALTITUDE_NOT_DERIVED/);
});

test("a schema v1 file still loads and replays at measurement level", () => {
  const { session } = recordSession(OPTS);
  const v1 = clone(session);
  v1.schemaVersion = 1;
  delete v1.rawSensors; delete v1.device; delete v1.results;
  v1.estimate = toSessionEstimate(runNavigation(session.measurements, session.algorithmConfig));
  const loaded = parseSession(JSON.stringify(v1));
  const r = replaySession(loaded);
  assert.equal(r.level, "measurement");
  assert.equal(r.reproducible, true);
  assert.equal(recordedEstimate(loaded).measurementCount, 6);
});

test("raw replay on a v1 file reports that there are no raw records", () => {
  const { session } = recordSession(OPTS);
  const v1 = clone(session);
  v1.schemaVersion = 1; delete v1.rawSensors; delete v1.device; delete v1.results;
  v1.estimate = null;
  const r = replaySession(parseSession(JSON.stringify(v1)), { level: "raw" });
  assert.equal(r.reproducible, null);
});

test("unknown schema versions are still refused", () => {
  const obj = clone(recordSession(OPTS).session);
  obj.schemaVersion = 3;
  assert.throws(() => parseSession(JSON.stringify(obj)), /schemaVersion/);
});

test("a v2 session with a recorded result for an earlier count is not treated as verified", () => {
  const { session } = recordSession(OPTS);
  const obj = clone(session);
  obj.results[0].measurementCount = 4;
  assert.equal(replaySession(parseSession(JSON.stringify(obj))).reproducible, null);
});
