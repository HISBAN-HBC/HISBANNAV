import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import { haversineKm } from "../core/hisban-core.js";
import { estimateJoint, estimatePositionOnly, levenbergMarquardt, requireSigmas } from "./index.js";

// هندسة اختبار: الجزائر، 10 نوفمبر 2026، قياسات كل 2 ساعة (N=5، نافذة 8h)
const LAT = 36.75, LON = 3.04;
const BASE = Date.UTC(2026, 10, 10, 7);
const OFFSETS_MIN = [0, 120, 240, 360, 480];

function synth({ bias = 0, sigmaAlt = 1, sigmaAz = 3, lat = LAT, lon = LON } = {}) {
  return OFFSETS_MIN.map((m) => {
    const utcMs = BASE + m * 60_000;
    const p = solarPosition(utcMs, lat, lon);
    return { utcMs, altitudeDeg: p.altitudeDeg, azimuthDeg: p.azimuthDeg + bias, sigmaAlt, sigmaAz };
  });
}

test("joint recovers position and bias on noise-free data", () => {
  const meas = synth({ bias: 7 });
  const { best } = estimateJoint(meas);
  assert.ok(haversineKm(best.p[0], best.p[1], LAT, LON) < 5, `position error ${haversineKm(best.p[0], best.p[1], LAT, LON)} km`);
  assert.ok(Math.abs(best.p[2] - 7) < 0.1, `bias ${best.p[2]}`);
  assert.ok(best.chi2 < 1e-3, `chi2 ${best.chi2}`);
});

test("position-only recovers position when bias is truly zero", () => {
  const meas = synth({ bias: 0 });
  const { best, mode } = estimatePositionOnly(meas);
  assert.equal(mode, "POSITION_ONLY");
  assert.equal(best.p[2], 0);
  assert.ok(haversineKm(best.p[0], best.p[1], LAT, LON) < 5);
});

test("fixed bias is kept exactly at the given value", () => {
  const meas = synth({ bias: 4 });
  const { best } = estimateJoint(meas, { fixB: 4 });
  assert.equal(best.p[2], 4);
});

test("missing sigma is rejected, not silently defaulted", () => {
  const meas = synth();
  delete meas[2].sigmaAz;
  assert.throws(() => requireSigmas(meas), /sigmaAlt and sigmaAz/);
  assert.throws(() => estimateJoint(meas), /sigmaAlt and sigmaAz/);
});

test("sigma scales the fit: a larger sigma does not change the minimiser on noise-free data", () => {
  const a = estimateJoint(synth({ bias: 5, sigmaAz: 3 })).best.p;
  const b = estimateJoint(synth({ bias: 5, sigmaAz: 6 })).best.p;
  assert.ok(Math.abs(a[2] - b[2]) < 0.05, `bias differs ${a[2]} vs ${b[2]}`);
});

test("at least two measurements are required", () => {
  assert.throws(() => estimateJoint(synth().slice(0, 1)), /at least 2/);
});

test("single LM run converges from the true neighbourhood", () => {
  const meas = synth({ bias: -6 });
  const r = levenbergMarquardt([LAT + 0.5, LON - 0.5, 0], meas);
  assert.ok(Math.abs(r.p[2] + 6) < 0.2, `bias ${r.p[2]}`);
});
