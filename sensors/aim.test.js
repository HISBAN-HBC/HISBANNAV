import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateAim, DEFAULT_CAMERA_AXIS } from "./index.js";
import { DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { enuToAltAz, boresightEnu } from "./attitude.js";

const qx90 = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };
const T0 = Date.UTC(2026, 10, 21, 0, 10);
const window = (q, n = 12, stepMs = 100, jitter = null) =>
  Array.from({ length: n }, (_, i) => ({
    timestampUtc: new Date(T0 + i * stepMs).toISOString(),
    quaternion: jitter ? jitter(i) : q,
  }));

test("a steady window yields the boresight direction with the floor as sigma", () => {
  const r = aggregateAim(window(qx90), DEFAULT_ALGORITHM_CONFIG);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.solarAltitudeDeg) < 1e-6);
  assert.ok(Math.abs(r.solarAzimuthDeg) < 1e-6);
  assert.ok(Math.abs(r.sigmaAltitudeDeg - DEFAULT_ALGORITHM_CONFIG.aimFloorDeg) < 1e-9);
  assert.ok(Math.abs(r.sigmaAzimuthDeg - DEFAULT_ALGORITHM_CONFIG.aimFloorDeg) < 1e-9);
});

test("too few samples is refused with the count", () => {
  const r = aggregateAim(window(qx90, 4), DEFAULT_ALGORITHM_CONFIG);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "TOO_FEW_SAMPLES");
});

test("a moving phone is refused, with the instruction to hold still", () => {
  const spin = (i) => {
    const a = (i * 3 * Math.PI) / 180; // 3° كل 100 ms = 30°/s
    return { w: Math.cos(a / 2), x: 0, y: 0, z: Math.sin(a / 2) };
  };
  const r = aggregateAim(window(null, 12, 100, spin), DEFAULT_ALGORITHM_CONFIG);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "PHONE_MOVING");
  assert.match(r.message, /ثبّت/);
});

test("non-increasing timestamps are refused", () => {
  const w = window(qx90);
  w[5].timestampUtc = w[3].timestampUtc;
  assert.equal(aggregateAim(w, DEFAULT_ALGORITHM_CONFIG).reason, "NON_MONOTONIC_TIME");
});

test("a calibration offset changes the aimed direction", () => {
  const r = aggregateAim(window({ w: 1, x: 0, y: 0, z: 0 }), DEFAULT_ALGORITHM_CONFIG, { offsetQuaternion: qx90 });
  assert.ok(Math.abs(r.solarAltitudeDeg) < 1e-6);
});

test("the aggregate equals the direct boresight for a steady window", () => {
  const direct = enuToAltAz(boresightEnu(qx90, { axis: DEFAULT_CAMERA_AXIS }));
  const r = aggregateAim(window(qx90), DEFAULT_ALGORITHM_CONFIG);
  assert.ok(Math.abs(r.solarAzimuthDeg - direct.azimuthDeg) < 1e-9);
});

test("a noisy window (tremor of ±0.2°) has sigma above the floor, measured from its spread", () => {
  const noisy = (i) => {
    const a = ((i % 2 ? 1 : -1) * 0.2 * Math.PI) / 180 / 2; // ±0.2° حول z (ارتعاش يدوي)
    return { w: Math.cos(a / 2), x: 0, y: 0, z: Math.sin(a / 2) };
  };
  const combined = (i) => {
    const n = noisy(i);
    return quatMulLocal(n, qx90);
  };
  const r = aggregateAim(window(null, 12, 100, combined), DEFAULT_ALGORITHM_CONFIG);
  assert.equal(r.ok, true);
  assert.ok(r.sigmaAzimuthDeg > DEFAULT_ALGORITHM_CONFIG.aimFloorDeg);
});

test("jitter of ±2° every 100 ms is movement, not noise, and is refused", () => {
  const jitter = (i) => {
    const a = ((i % 2 ? 1 : -1) * 2 * Math.PI) / 180 / 2;
    return quatMulLocal({ w: Math.cos(a / 2), x: 0, y: 0, z: Math.sin(a / 2) }, qx90);
  };
  assert.equal(aggregateAim(window(null, 12, 100, jitter), DEFAULT_ALGORITHM_CONFIG).reason, "PHONE_MOVING");
});

function quatMulLocal(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
