import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import {
  createSession, addMeasurement, addResult, setTruth, serializeSession, parseSession,
  exportMeasurementsCsv, createLogger, DEFAULT_ALGORITHM_CONFIG, replaySession, toSessionEstimate,
} from "./index.js";
import { runNavigation } from "../pipeline/index.js";

const LAT = 36.75, LON = 3.04;
const BASE = Date.UTC(2026, 10, 10, 7);
function sample(bias = 5) {
  return [0, 120, 240, 360, 480].map((m) => {
    const t = new Date(BASE + m * 60_000);
    const p = solarPosition(t.getTime(), LAT, LON);
    return {
      timestampUtc: t.toISOString(),
      solarAltitudeDeg: p.altitudeDeg,
      solarAzimuthDeg: (p.azimuthDeg + bias + 360) % 360,
      sigmaAltitudeDeg: 1,
      sigmaAzimuthDeg: 3,
      compassHeadingDeg: null,
      sensorQuality: "GOOD",
    };
  });
}

function recordedSession(bias = 5) {
  let s = createSession({ sessionId: "S-001", appVersion: "0.1.0", algorithmVersion: "2026.11", algorithmConfig: DEFAULT_ALGORITHM_CONFIG, startedAtUtc: "2026-11-10T07:00:00Z" });
  for (const m of sample(bias)) s = addMeasurement(s, m);
  const r = runNavigation(s.measurements, s.algorithmConfig);
  s = addResult(s, toSessionEstimate(r));
  return setTruth(s, { gnssLatitudeDeg: LAT, gnssLongitudeDeg: LON, accuracyM: 8 });
}

test("algorithmConfig must be recorded and complete", () => {
  assert.throws(() => createSession({ sessionId: "x", appVersion: "1", algorithmVersion: "1", algorithmConfig: { driftDThreshold: 3 } }), /algorithmConfig/);
});

test("a measurement without sigma is rejected", () => {
  const s = createSession({ sessionId: "x", appVersion: "1", algorithmVersion: "1", algorithmConfig: DEFAULT_ALGORITHM_CONFIG });
  const m = sample()[0];
  delete m.sigmaAzimuthDeg;
  assert.throws(() => addMeasurement(s, m), /sigmaAzimuthDeg/);
});

test("session sessions are immutable: adding returns a new object", () => {
  const s0 = createSession({ sessionId: "x", appVersion: "1", algorithmVersion: "1", algorithmConfig: DEFAULT_ALGORITHM_CONFIG });
  const s1 = addMeasurement(s0, sample()[0]);
  assert.equal(s0.measurements.length, 0);
  assert.equal(s1.measurements.length, 1);
});

test("serialization is stable and round-trips through parse", () => {
  const s = recordedSession();
  const text = serializeSession(s);
  assert.equal(serializeSession(parseSession(text)), text);
});

test("parse rejects an unknown schema version", () => {
  const obj = JSON.parse(serializeSession(recordedSession()));
  obj.schemaVersion = 99;
  assert.throws(() => parseSession(JSON.stringify(obj)), /schemaVersion/);
});

test("CSV export contains one row per measurement plus header", () => {
  const csv = exportMeasurementsCsv(recordedSession());
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 1 + 5);
  assert.ok(lines[0].startsWith("timestampUtc,solarAltitudeDeg"));
});

test("logger records events in order with payloads", () => {
  const sink = [];
  const log = createLogger({ sink: (e) => sink.push(e) });
  log.sessionStarted({ sessionId: "S" });
  log.measurementAdded(0);
  log.warning("DRIFT", "x");
  assert.deepEqual(sink.map((e) => e.type), ["SESSION_STARTED", "MEASUREMENT_ADDED", "WARNING"]);
  assert.equal(log.events().length, 3);
});

test("replay reproduces the recorded estimate from measurements alone", () => {
  const s = parseSession(serializeSession(recordedSession()));
  const r = replaySession(s);
  assert.equal(r.reproducible, true, JSON.stringify(r.diffs));
});

test("replay detects a changed measurement (recording is not silently accepted)", () => {
  const obj = JSON.parse(serializeSession(recordedSession(5)));
  obj.measurements[2].solarAzimuthDeg = (obj.measurements[2].solarAzimuthDeg + 6) % 360;
  const r = replaySession(parseSession(JSON.stringify(obj)));
  assert.equal(r.reproducible, false);
  assert.ok(r.diffs.length > 0);
});

test("replay without a recorded estimate reports null, not success", () => {
  let s = createSession({ sessionId: "x", appVersion: "1", algorithmVersion: "1", algorithmConfig: DEFAULT_ALGORITHM_CONFIG });
  for (const m of sample()) s = addMeasurement(s, m);
  assert.equal(replaySession(s).reproducible, null);
});
