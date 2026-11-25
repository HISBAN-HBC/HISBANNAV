import { test } from "node:test";
import assert from "node:assert/strict";
import { boresightEnu, enuToAltAz, quatMul } from "./attitude.js";

const I = { w: 1, x: 0, y: 0, z: 0 };
const qx90 = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };   // دوران 90° حول x
const qz_minus90 = { w: Math.SQRT1_2, x: 0, y: 0, z: -Math.SQRT1_2 }; // دوران -90° حول z
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("phone lying screen-up, camera points down: altitude -90", () => {
  const { altitudeDeg } = enuToAltAz(boresightEnu(I));
  near(altitudeDeg, -90);
});

test("phone screen-down, camera points up at the zenith: altitude +90", () => {
  const { altitudeDeg } = enuToAltAz(boresightEnu({ w: 0, x: 1, y: 0, z: 0 }));
  near(altitudeDeg, 90);
});

test("upright phone with camera level and facing north: altitude 0, azimuth 0", () => {
  const { altitudeDeg, azimuthDeg } = enuToAltAz(boresightEnu(qx90));
  near(altitudeDeg, 0); near(azimuthDeg, 0);
});

test("the same phone turned to face east: azimuth 90 (roll and yaw handled by the rotation)", () => {
  const q = quatMul(qz_minus90, qx90);
  const { altitudeDeg, azimuthDeg } = enuToAltAz(boresightEnu(q));
  near(altitudeDeg, 0); near(azimuthDeg, 90);
});

test("a calibration offset rotates the camera axis into the right direction", () => {
  // بدون معايرة: الكاميرا تنظر لأسفل. مع إزاحة 90° حول x تنظر نحو الشمال أفقياً.
  const { altitudeDeg, azimuthDeg } = enuToAltAz(boresightEnu(I, { offsetQuaternion: qx90 }));
  near(altitudeDeg, 0); near(azimuthDeg, 0);
});

test("azimuth is always in [0, 360)", () => {
  for (let k = 0; k < 360; k += 15) {
    const a = (k * Math.PI) / 360;
    const q = { w: Math.cos(a), x: 0, y: 0, z: Math.sin(a) };
    const { azimuthDeg } = enuToAltAz(boresightEnu(quatMul(q, qx90)));
    assert.ok(azimuthDeg >= 0 && azimuthDeg < 360, `az ${azimuthDeg}`);
  }
});
