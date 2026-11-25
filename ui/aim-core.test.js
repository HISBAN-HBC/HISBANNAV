import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, serializeSession, parseSession, replaySession, DEFAULT_ALGORITHM_CONFIG } from "../research/index.js";
import { recordAimWindow } from "./aim-core.js";

const qx90 = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };
const qx90b = { w: Math.SQRT1_2, x: 0, y: Math.SQRT1_2, z: 0 }; // اتجاه مختلف قليلاً
const T0 = Date.UTC(2026, 10, 21, 0, 10);
const steady = (q, t0, n = 12) => Array.from({ length: n }, (_, i) => ({ timestampUtc: new Date(t0 + i * 100).toISOString(), quaternion: q }));
const fresh = () => createSession({ sessionId: "AIM-UI", appVersion: "0.1.0", algorithmVersion: "2026.11", algorithmConfig: DEFAULT_ALGORITHM_CONFIG, device: { platform: "ANDROID_CHROME" } });

test("an accepted window becomes a measurement linked to its raw samples, and a result", () => {
  const { session, outcome } = recordAimWindow(fresh(), steady(qx90, T0));
  assert.equal(outcome.ok, true);
  assert.equal(session.rawSensors.imu.length, 12);
  assert.equal(session.measurements.length, 1);
  assert.equal(session.measurements[0].sourceSensorIndexes.imu.length, 12);
  assert.equal(session.results.length, 0, "one measurement is not enough for the pipeline");
});

test("a moving window is refused, but its raw samples are still recorded as evidence", () => {
  const moving = steady(qx90, T0).map((s, i) => ({ ...s, quaternion: i % 2 ? qx90 : qx90b }));
  const { session, outcome } = recordAimWindow(fresh(), moving);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "PHONE_MOVING");
  assert.match(outcome.message, /ثبّت/);
  assert.equal(session.measurements.length, 0);
  assert.equal(session.rawSensors.imu.length, 12);
});

test("two accepted windows produce a pipeline result tied to the final measurement count", () => {
  let { session } = recordAimWindow(fresh(), steady(qx90, T0));
  ({ session } = recordAimWindow(session, steady(qx90b, T0 + 60_000)));
  assert.equal(session.measurements.length, 2);
  assert.equal(session.results.length, 1);
  assert.equal(session.results[0].measurementCount, 2);
});

test("a session recorded from the page replays from its raw samples exactly", () => {
  let { session } = recordAimWindow(fresh(), steady(qx90, T0));
  ({ session } = recordAimWindow(session, steady(qx90b, T0 + 60_000)));
  const loaded = parseSession(serializeSession(session));
  assert.equal(replaySession(loaded, { level: "raw" }).reproducible, true);
});
