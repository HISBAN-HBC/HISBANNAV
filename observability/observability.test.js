import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import { estimateJoint } from "../estimator/index.js";
import { assessObservability, eigSym2, positionCovarianceKm } from "./index.js";

const LAT = 36.75, LON = 3.04;
const BASE = Date.UTC(2026, 10, 10, 7);
const meas = [0, 120, 240, 360, 480].map((m) => {
  const utcMs = BASE + m * 60_000;
  const p = solarPosition(utcMs, LAT, LON);
  return { utcMs, altitudeDeg: p.altitudeDeg, azimuthDeg: p.azimuthDeg + 5, sigmaAlt: 1, sigmaAz: 3 };
});

test("eigenvalues of a diagonal matrix are its diagonal entries", () => {
  const e = eigSym2([[4, 0], [0, 9]]);
  assert.equal(e.max, 9);
  assert.equal(e.min, 4);
});

test("km conversion scales longitude by cos(latitude)", () => {
  const p = positionCovarianceKm([[1, 0], [0, 1]], 60);
  // σ_lat = 111.195 km، σ_lon = 111.195·cos60 = 55.6 km، والتغاير قطري
  assert.ok(Math.abs(p.cov[0][0] - 111.195 ** 2) < 1e-6);
  assert.ok(Math.abs(p.cov[1][1] - (111.195 * 0.5) ** 2) < 1e-6);
  assert.equal(p.rho, 0);
});

test("well-spread solar geometry is OBSERVABLE with a finite position sigma", () => {
  const { best } = estimateJoint(meas);
  const a = assessObservability(best.p, meas);
  assert.equal(a.mode, "OBSERVABLE", a.reason);
  assert.ok(Number.isFinite(a.sigmaPosKm) && a.sigmaPosKm > 0);
  assert.ok(a.sigmaBiasDeg > 0);
});

test("limits are explicit: a strict position limit makes the same geometry UNOBSERVABLE", () => {
  const { best } = estimateJoint(meas);
  const a = assessObservability(best.p, meas, { limits: { maxSigmaPosKm: 0.001, maxSigmaBiasDeg: 2, maxAbsRho: 0.9 } });
  assert.equal(a.mode, "UNOBSERVABLE");
});

test("a bias limit makes the same geometry POSITION_ONLY", () => {
  const { best } = estimateJoint(meas);
  const a = assessObservability(best.p, meas, { limits: { maxSigmaPosKm: 1e6, maxSigmaBiasDeg: 1e-6, maxAbsRho: 1 } });
  assert.equal(a.mode, "POSITION_ONLY");
});
