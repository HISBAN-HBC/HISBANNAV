import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import { estimateJoint } from "../estimator/index.js";
import { driftD, outlierStats, classifySensor, classifyState } from "./index.js";

const LAT = 36.75, LON = 3.04;
const BASE = Date.UTC(2026, 10, 10, 7);
const OFF = [0, 120, 240, 360, 480];
function synth({ bias = 5, drift = 0, outlierIdx = -1, outlier = 0, jump = 0 } = {}) {
  return OFF.map((m, k) => {
    const utcMs = BASE + m * 60_000;
    const p = solarPosition(utcMs, LAT, LON);
    const hours = (utcMs - BASE) / 3_600_000;
    let A = p.azimuthDeg + bias + drift * hours;
    if (k === outlierIdx) A += outlier;
    if (jump && k >= 2) A += jump;
    return { utcMs, altitudeDeg: p.altitudeDeg, azimuthDeg: A, sigmaAlt: 1, sigmaAz: 3 };
  });
}

test("D is near zero for a stable compass (noise-free)", () => {
  const meas = synth();
  const { best } = estimateJoint(meas);
  assert.ok(driftD(best.p, meas).D < 2, `D ${driftD(best.p, meas).D}`);
});

test("D >= 3 for a clear drift of 5 deg/h", () => {
  const meas = synth({ drift: 5 });
  const { best } = estimateJoint(meas);
  assert.ok(driftD(best.p, meas).D >= 3, `D ${driftD(best.p, meas).D}`);
});

test("sensor state is DRIFT when D >= 3", () => {
  assert.equal(classifySensor({ D: 3.2, outliers: [] }).sensor, "DRIFT");
  assert.equal(classifySensor({ D: 2.5, outliers: [] }).sensor, "SUSPECT");
  assert.equal(classifySensor({ D: 0.4, outliers: [] }).sensor, "STABLE");
});

test("a single 15 deg outlier is flagged as OUTLIER_SUSPECT, not deleted", () => {
  const meas = synth({ outlierIdx: 2, outlier: 15 });
  const { best } = estimateJoint(meas);
  const os = outlierStats(meas, best);
  assert.ok(os[2].O > 10 && Math.abs(os[2].t) > 3, JSON.stringify(os[2]));
  const s = classifyState({ D: driftD(best.p, meas).D, outliers: os, navigation: "OBSERVABLE" });
  assert.equal(s.sensor, "OUTLIER_SUSPECT");
  assert.equal(meas.length, 5, "no measurement is removed automatically");
  assert.ok(s.warnings.some((w) => w.code === "OUTLIER_SUSPECT" && w.index === 2));
});

test("navigation state is reported separately from sensor state", () => {
  const s = classifyState({ D: 0, outliers: [], navigation: "POSITION_ONLY" });
  assert.equal(s.sensor, "STABLE");
  assert.equal(s.navigation, "POSITION_ONLY");
  assert.ok(s.warnings.some((w) => w.code === "POSITION_ONLY"));
});

test("no JUMP_SUSPECT is produced from the sun alone", () => {
  const meas = synth({ jump: 12 });
  const { best } = estimateJoint(meas);
  const s = classifyState({ D: driftD(best.p, meas).D, outliers: outlierStats(meas, best), navigation: "OBSERVABLE" });
  assert.ok(!s.warnings.some((w) => w.code === "JUMP_SUSPECT"));
});
