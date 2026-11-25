import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, classifyPose, shortestArc, rotationAngleDeg, NADIR_ENU } from "./calibration-core.js";
import { saveCalibration, loadCalibration, offsetFor, STORAGE_KEY } from "./calibration-store.js";
import { DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { boresightEnu, quatMul, quatToMatrix, DEFAULT_CAMERA_AXIS } from "../sensors/index.js";

const T0 = Date.UTC(2026, 10, 21, 0, 30);
const samples = (q) => Array.from({ length: 12 }, (_, i) => ({ timestampUtc: new Date(T0 + i * 100).toISOString(), quaternion: q }));
const ident = { w: 1, x: 0, y: 0, z: 0 };
const qx90 = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };
const qx180 = { w: 0, x: 1, y: 0, z: 0 };
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("classifyPose: correct convention OK, 90° and 180° convention errors are named", () => {
  assert.equal(classifyPose(-88, -90).verdict, "OK");
  assert.equal(classifyPose(0, -90).verdict, "AXIS_90_ERROR");
  assert.equal(classifyPose(90, -90).verdict, "AXIS_180_ERROR");
  assert.equal(classifyPose(45, -90).verdict, "REPOSITION");
});

test("shortest arc maps the vector onto the target", () => {
  const q = shortestArc([1, 0, 0], [0, 1, 0]);
  const M = quatToMatrix(q);
  const mapped = [M[0][0], M[1][0], M[2][0]];
  near(mapped[1], 1, 1e-9); near(mapped[0], 0, 1e-9);
  near(rotationAngleDeg(shortestArc([0, 0, 1], [0, 0, 1])), 0, 1e-9);
  near(rotationAngleDeg(shortestArc([0, 0, 1], [0, 0, -1])), 180, 1e-9);
});

test("a correctly built phone needs no offset: identity, 0° boresight offset", () => {
  const r = calibrate({ nadirSamples: samples(ident), zenithSamples: samples(qx180), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, true, r.message);
  near(r.record.cameraBoresightOffsetDeg, 0, 1e-6);
  near(r.record.residualDeg, 0, 1e-6);
});

test("a camera axis tilted by 10° inside the phone is measured and absorbed", () => {
  // محور الكاميرا الفعلي مائل 10° في إطار الجهاز
  const tilt = { w: Math.cos(Math.PI / 36), x: Math.sin(Math.PI / 36), y: 0, z: 0 };
  const dTrue = (() => { const M = quatToMatrix(tilt); return DEFAULT_CAMERA_AXIS.map((_, i) => M[i][2] * -1); })();
  const qNadir = shortestArc(dTrue, NADIR_ENU);   // الهاتف حيث تنظر الكاميرا الفعلية إلى الأسفل
  const qZenith = shortestArc(dTrue, [0, 0, 1]);  // وحيث تنظر إلى الأعلى
  const r = calibrate({ nadirSamples: samples(qNadir), zenithSamples: samples(qZenith), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, true, r.message);
  near(r.record.cameraBoresightOffsetDeg, 10, 0.05);
  near(r.record.residualDeg, 0, 0.05);
  // بعد الإزاحة، الوضع nadir يعطي −90 فعلاً
  near(boresightEnu(qNadir, { offsetQuaternion: r.record.offsetQuaternion })[2], -1, 1e-6);
});

test("a 90° convention error in the framework is refused with its name", () => {
  const r = calibrate({ nadirSamples: samples(qx90), zenithSamples: samples(qx180), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "NADIR");
  assert.equal(r.reason, "AXIS_90_ERROR");
});

test("a 180° (inverted) convention error is refused with its name", () => {
  const r = calibrate({ nadirSamples: samples(qx180), zenithSamples: samples(ident), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "AXIS_180_ERROR");
});

test("a tilt beyond the nadir tolerance is refused as REPOSITION, not silently stored", () => {
  const tilt = { w: Math.cos(Math.PI / 12), x: Math.sin(Math.PI / 12), y: 0, z: 0 }; // 30°
  const dTrue = (() => { const M = quatToMatrix(tilt); return [0, 1, 2].map((i) => M[i][2] * -1); })();
  const r = calibrate({ nadirSamples: samples(shortestArc(dTrue, NADIR_ENU)), zenithSamples: samples(shortestArc(dTrue, [0, 0, 1])), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "REPOSITION");
});

test("a moving phone during calibration is refused, not averaged", () => {
  const moving = samples(ident).map((s, i) => ({ ...s, quaternion: i % 2 ? qx90 : ident }));
  const r = calibrate({ nadirSamples: moving, zenithSamples: samples(qx180), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "PHONE_MOVING");
});

test("an offset inside the nadir tolerance but above the warning level is stored and flagged", () => {
  // 18°: داخل حد قبول الوضع (20°) وفوق حد التحذير (15°)
  const tilt = { w: Math.cos(Math.PI / 20), x: Math.sin(Math.PI / 20), y: 0, z: 0 };
  const dTrue = (() => { const M = quatToMatrix(tilt); return [0, 1, 2].map((i) => M[i][2] * -1); })();
  const r = calibrate({ nadirSamples: samples(shortestArc(dTrue, NADIR_ENU)), zenithSamples: samples(shortestArc(dTrue, [0, 0, 1])), cfg: DEFAULT_ALGORITHM_CONFIG });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test("calibration round-trips through storage with its date and device", () => {
  const st = fakeStorage();
  const r = calibrate({ nadirSamples: samples(ident), zenithSamples: samples(qx180), cfg: DEFAULT_ALGORITHM_CONFIG, device: { userAgent: "UA-1", platform: "ANDROID_CHROME", calibratedAtUtc: "2026-11-21T00:30:00.000Z" } });
  saveCalibration(st, r.record);
  const loaded = loadCalibration(st, { userAgent: "UA-1" });
  assert.equal(loaded.calibratedAtUtc, "2026-11-21T00:30:00.000Z");
  assert.equal(loaded.device.platform, "ANDROID_CHROME");
  assert.equal(loaded.deviceMismatch, false);
});

test("a calibration from another device is still shown, but flagged as mismatched", () => {
  const st = fakeStorage();
  const r = calibrate({ nadirSamples: samples(ident), zenithSamples: samples(qx180), cfg: DEFAULT_ALGORITHM_CONFIG, device: { userAgent: "UA-1" } });
  saveCalibration(st, r.record);
  assert.equal(loadCalibration(st, { userAgent: "UA-2" }).deviceMismatch, true);
});

test("no or corrupt calibration yields null, and the session falls back to identity", () => {
  const st = fakeStorage();
  assert.equal(loadCalibration(st), null);
  st.setItem(STORAGE_KEY, "{not json");
  assert.equal(loadCalibration(st), null);
  assert.deepEqual(offsetFor(null), { w: 1, x: 0, y: 0, z: 0 });
});
