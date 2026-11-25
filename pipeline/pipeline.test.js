import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import { runNavigation, DEFAULT_ALGORITHM_CONFIG, RUN_STATUS, recommend } from "./index.js";

const LAT = -35, LON = 150;
const BASE = Date.UTC(2026, 10, 10, 1, 46);

function series({ offsetsMin, biasAt = () => 4 }) {
  return offsetsMin.map((m) => {
    const t = new Date(BASE + m * 60_000);
    const p = solarPosition(t.getTime(), LAT, LON);
    return {
      timestampUtc: t.toISOString(),
      solarAltitudeDeg: p.altitudeDeg,
      solarAzimuthDeg: (((p.azimuthDeg + biasAt(m)) % 360) + 360) % 360,
      sigmaAltitudeDeg: 1,
      sigmaAzimuthDeg: 3,
      compassHeadingDeg: null,
      sensorQuality: "GOOD",
    };
  });
}

test("result has exactly the unified shape the UI consumes", () => {
  const r = runNavigation(series({ offsetsMin: [0, 30, 60, 90, 120] }));
  assert.equal(r.status, RUN_STATUS.OK);
  for (const k of ["estimate", "uncertainty", "navigationState", "sensorState", "candidates", "diagnostics", "nextMeasurementRecommendation"]) {
    assert.ok(k in r, `missing ${k}`);
  }
  assert.ok(r.candidates.length <= DEFAULT_ALGORITHM_CONFIG.startsK);
});

test("clean series recovers the planted position and bias", () => {
  const r = runNavigation(series({ offsetsMin: [0, 30, 60, 90, 120] }));
  assert.ok(Math.abs(r.estimate.latitudeDeg - LAT) < 0.01, `lat ${r.estimate.latitudeDeg}`);
  assert.ok(Math.abs(r.estimate.longitudeDeg - LON) < 0.01, `lon ${r.estimate.longitudeDeg}`);
  assert.ok(Math.abs(r.estimate.biasDeg - 4) < 0.01, `bias ${r.estimate.biasDeg}`);
});

test("navigation and sensor states are reported separately, never merged", () => {
  const r = runNavigation(series({ offsetsMin: [0, 30, 60, 90, 120] }));
  assert.ok(["OBSERVABLE", "POSITION_ONLY", "UNOBSERVABLE"].includes(r.navigationState));
  assert.ok(["STABLE", "DRIFT", "OUTLIER_SUSPECT", "SUSPECT", "INSUFFICIENT_DATA"].includes(r.sensorState));
  assert.equal("confidence" in r, false);
});

test("a 10 degree-per-hour compass drift over two hours is flagged as DRIFT", () => {
  const r = runNavigation(series({ offsetsMin: [0, 15, 30, 45, 60, 75, 90, 105, 120], biasAt: (m) => 4 + (10 * m) / 60 }));
  assert.equal(r.sensorState, "DRIFT", `got ${r.sensorState}, D=${r.diagnostics.driftD}`);
});

test("a 5 degree-per-hour drift over two hours is never reported as STABLE", () => {
  // قياس الحد: D ≈ 2.5 أقل من عتبة DRIFT (3)، فيُصنَّف SUSPECT لا STABLE.
  const r = runNavigation(series({ offsetsMin: [0, 15, 30, 45, 60, 75, 90, 105, 120], biasAt: (m) => 4 + (5 * m) / 60 }));
  assert.notEqual(r.sensorState, "STABLE", `D=${r.diagnostics.driftD}`);
});

test("an invalid measurement is rejected with its index, not silently fixed", () => {
  const meas = series({ offsetsMin: [0, 30, 60] });
  meas[1].sigmaAzimuthDeg = 0;
  const r = runNavigation(meas);
  assert.equal(r.status, RUN_STATUS.REJECTED);
  assert.deepEqual(r.errors, [{ scope: "measurement", index: 1, message: "sigmaAzimuthDeg is required (> 0)" }]);
  assert.equal(r.estimate, null);
});

test("an invalid algorithm config is rejected before any computation", () => {
  const { biasBoundDeg, ...rest } = DEFAULT_ALGORITHM_CONFIG;
  const r = runNavigation(series({ offsetsMin: [0, 30, 60] }), rest);
  assert.equal(r.status, RUN_STATUS.REJECTED);
  assert.equal(r.errors[0].scope, "config");
  assert.match(r.errors[0].message, /biasBoundDeg/);
});

test("one measurement waits; it is not a navigation result", () => {
  const r = runNavigation(series({ offsetsMin: [0] }));
  assert.equal(r.status, RUN_STATUS.WAITING);
  assert.equal(r.estimate, null);
  assert.equal(r.sensorState, "INSUFFICIENT_DATA");
});

test("two measurements give a position but no sensor verdict", () => {
  const r = runNavigation(series({ offsetsMin: [0, 60] }));
  assert.equal(r.status, RUN_STATUS.OK);
  assert.equal(r.sensorState, "INSUFFICIENT_DATA");
  assert.equal(r.diagnostics.driftD, null);
});

test("provisional observability limits are read from the recorded config", () => {
  const meas = series({ offsetsMin: [0, 30, 60, 90, 120] });
  const loose = runNavigation(meas, DEFAULT_ALGORITHM_CONFIG);
  const strict = runNavigation(meas, { ...DEFAULT_ALGORITHM_CONFIG, observabilityPositionSigmaKm: 0.001 });
  assert.equal(strict.navigationState, "UNOBSERVABLE");
  assert.notEqual(loose.navigationState, "UNOBSERVABLE");
});

test("recommendations are advisory codes, one per situation", () => {
  assert.equal(recommend("UNOBSERVABLE", "STABLE").code, "COLLECT_LONGER_SPAN");
  assert.equal(recommend("POSITION_ONLY", "STABLE").code, "COLLECT_MORE_GEOMETRY");
  assert.equal(recommend("OBSERVABLE", "INSUFFICIENT_DATA").code, "COLLECT_MORE");
  assert.equal(recommend("OBSERVABLE", "DRIFT").code, "RECHECK_SENSOR");
  assert.equal(recommend("OBSERVABLE", "STABLE").code, "NONE");
});
