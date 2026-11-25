import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession, addRawReading, addMeasurement, addResult, serializeSession, parseSession, replaySession,
} from "./index.js";
import { runNavigation, DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { aggregateAim, toRawImuRecord } from "../sensors/index.js";

const qx90 = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };
const qz = (q) => ({ // دوران -90° حول z بعد q
  w: Math.SQRT1_2 * q.w - 0 * q.x - 0 * q.y + Math.SQRT1_2 * q.z,
  x: Math.SQRT1_2 * q.x + 0 * q.w + 0 * q.z - Math.SQRT1_2 * q.y,
  y: Math.SQRT1_2 * q.y - 0 * q.z + 0 * q.w + Math.SQRT1_2 * q.x,
  z: Math.SQRT1_2 * q.z + 0 * q.y - 0 * q.x - Math.SQRT1_2 * q.w,
});
const T0 = Date.UTC(2026, 10, 21, 0, 10);
const clone = (s) => JSON.parse(serializeSession(s));

/** يبني جلسة بقياسين من نافذتي تصويب، كما يفعل التطبيق. */
function boresightSession({ calibration } = {}) {
  let s = createSession({ sessionId: "AIM-1", appVersion: "0.1.0", algorithmVersion: "2026.11", algorithmConfig: DEFAULT_ALGORITHM_CONFIG, device: { platform: "ANDROID_CHROME" }, calibration });
  const windows = [{ q: qx90, t: T0 }, { q: qz(qx90), t: T0 + 60_000 }];
  for (const w of windows) {
    const samples = Array.from({ length: 12 }, (_, i) => ({ timestampUtc: new Date(w.t + i * 100).toISOString(), quaternion: w.q }));
    const idxs = samples.map((smp) => {
      s = addRawReading(s, "imu", toRawImuRecord(smp));
      return s.rawSensors.imu.length - 1;
    });
    const agg = aggregateAim(samples, DEFAULT_ALGORITHM_CONFIG, { offsetQuaternion: s.calibration.offsetQuaternion });
    s = addMeasurement(s, {
      timestampUtc: samples[0].timestampUtc, method: "BORESIGHT", solarAltitudeDeg: agg.solarAltitudeDeg, solarAzimuthDeg: agg.solarAzimuthDeg,
      sigmaAltitudeDeg: agg.sigmaAltitudeDeg, sigmaAzimuthDeg: agg.sigmaAzimuthDeg, compassHeadingDeg: null, sensorQuality: "UNKNOWN",
    }, { imu: idxs });
  }
  return s;
}

/** نفس الجلسة مع نتيجة حقيقية من الخط (لا قيم مكتوبة يدوياً). */
function withRealResult(s) {
  const r = runNavigation(s.measurements, s.algorithmConfig);
  return addResult(s, {
    latitudeDeg: r.estimate?.latitudeDeg ?? null, longitudeDeg: r.estimate?.longitudeDeg ?? null, biasDeg: r.estimate?.biasDeg ?? null,
    chiSquare: r.diagnostics?.chiSquare ?? null, uncertaintyKm: r.uncertainty?.positionKm ?? null,
    navigationState: r.navigationState, sensorState: r.sensorState,
  });
}

test("a boresight session replays from its raw orientation windows exactly", () => {
  const s = withRealResult(boresightSession());
  const loaded = parseSession(serializeSession(s));
  const r = replaySession(loaded, { level: "raw" });
  assert.equal(r.reproducible, true, JSON.stringify(r.diffs));
});

test("the measurement-level replay of the same session also agrees", () => {
  const s = withRealResult(boresightSession());
  assert.equal(replaySession(parseSession(serializeSession(s)), { level: "measurement" }).reproducible, true);
});

test("tampering one orientation sample inside a window is caught by raw replay", () => {
  const s = withRealResult(boresightSession());
  const obj = clone(s);
  obj.rawSensors.imu[4].orientation.quaternion = qz(qx90);
  const r = replaySession(parseSession(JSON.stringify(obj)), { level: "raw" });
  assert.equal(r.reproducible, false);
  assert.match(r.diffs[0], /measurement 0/);
});

test("a window that moved cannot be rebuilt into a measurement", () => {
  const s = withRealResult(boresightSession());
  const obj = clone(s);
  obj.rawSensors.imu[3].orientation.quaternion = qz(qz(qx90)); // قفزة كبيرة داخل النافذة
  const r = replaySession(parseSession(JSON.stringify(obj)), { level: "raw" });
  assert.equal(r.reproducible, false);
  assert.match(r.diffs[0], /PHONE_MOVING/);
});

test("the calibration offset is part of the record: changing it changes the replay", () => {
  const s = withRealResult(boresightSession());
  const obj = clone(s);
  obj.calibration.offsetQuaternion = qx90;
  const r = replaySession(parseSession(JSON.stringify(obj)), { level: "raw" });
  assert.equal(r.reproducible, false);
});

test("a window index that does not exist is refused when the measurement is added", () => {
  const s = boresightSession();
  assert.throws(() => addMeasurement(s, s.measurements[0], { imu: [0, 9999] }), /out of range/);
});

test("an empty window is refused", () => {
  const s = withRealResult(boresightSession());
  const obj = clone(s);
  obj.measurements[0].sourceSensorIndexes.imu = [];
  assert.throws(() => parseSession(JSON.stringify(obj)), /window is empty/);
});

test("a window cannot be used for compass or GNSS", () => {
  const s = boresightSession();
  assert.throws(() => addMeasurement(s, s.measurements[0], { compass: [0, 1] }), /cannot be a window/);
});
