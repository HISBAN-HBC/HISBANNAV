import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserOrientationProvider, BrowserGnssProvider, BrowserClockProvider, toRawImuRecord, createRealSensors } from "./index.js";

class FakeAbsoluteOrientationSensor extends EventTarget {
  constructor(opts) { super(); this.opts = opts; this.quaternion = [0, 0, 0, 1]; this.timestamp = 0; this.started = false; }
  start() { this.started = true; }
  stop() { this.started = false; }
  emit(q, ts) { this.quaternion = q; this.timestamp = ts; this.dispatchEvent(new Event("reading")); }
  fail(name) { const e = new Event("error"); e.error = { name }; this.dispatchEvent(e); }
}

test("no absolute-orientation API: read says so explicitly, nothing is invented", () => {
  const p = new BrowserOrientationProvider({});
  assert.equal(p.start(), false);
  assert.deepEqual(p.read(), { timestampUtc: null, available: false, reason: "SENSOR_UNSUPPORTED" });
});

test("orientation samples map the browser's [x,y,z,w] order to {w,x,y,z} and wall-clock time", () => {
  const env = { AbsoluteOrientationSensor: FakeAbsoluteOrientationSensor, performance: { timeOrigin: Date.UTC(2026, 10, 21, 0, 0) } };
  const p = new BrowserOrientationProvider(env);
  p.start();
  p._sensor.emit([0.1, 0.2, 0.3, 0.9], 60_000);
  const r = p.read();
  assert.equal(r.available, true);
  assert.deepEqual(r.quaternion, { w: 0.9, x: 0.1, y: 0.2, z: 0.3 });
  assert.equal(r.timestampUtc, "2026-11-21T00:01:00.000Z");
});

test("a permission error is reported as PERMISSION_DENIED, not as a silent gap", () => {
  const env = { AbsoluteOrientationSensor: FakeAbsoluteOrientationSensor, performance: { timeOrigin: 0 } };
  const p = new BrowserOrientationProvider(env);
  p.start();
  p._sensor.fail("NotAllowedError");
  assert.equal(p.read().reason, "PERMISSION_DENIED");
});

test("samplesBetween returns only the window asked for, in order", () => {
  const env = { AbsoluteOrientationSensor: FakeAbsoluteOrientationSensor, performance: { timeOrigin: 0 } };
  const p = new BrowserOrientationProvider(env);
  p.start();
  for (const t of [1000, 2000, 3000, 4000]) p._sensor.emit([0, 0, 0, 1], t);
  const w = p.samplesBetween(1500, 3500);
  assert.deepEqual(w.map((s) => s.timestampUtc), [new Date(2000).toISOString(), new Date(3000).toISOString()]);
});

test("raw IMU record from a sample keeps the quaternion and marks unmeasured sensors null", () => {
  const rec = toRawImuRecord({ timestampUtc: "2026-11-21T00:00:00.000Z", quaternion: { w: 1, x: 0, y: 0, z: 0 } });
  assert.equal(rec.accelerometer, null);
  assert.equal(rec.orientation.quaternion.w, 1);
  assert.equal(rec.available, true);
});

test("GNSS: a fix is mapped to the raw record shape; missing fields become null", () => {
  let cb;
  const env = {
    navigator: {
      geolocation: {
        watchPosition: (ok) => { cb = ok; return 7; },
        clearWatch: () => {},
      },
    },
  };
  const g = new BrowserGnssProvider(env);
  g.start();
  cb({ timestamp: Date.UTC(2026, 10, 21, 0, 2), coords: { latitude: 36.7, longitude: 3.04, altitude: null, accuracy: 6, speed: NaN, heading: null } });
  const r = g.read();
  assert.equal(r.available, true);
  assert.equal(r.altitudeM, null);
  assert.equal(r.speedMps, null);
  assert.equal(r.accuracyM, 6);
});

test("GNSS permission denied is named", () => {
  let errCb;
  const env = { navigator: { geolocation: { watchPosition: (_ok, err) => { errCb = err; return 1; }, clearWatch() {} } } };
  const g = new BrowserGnssProvider(env);
  g.start();
  errCb({ code: 1 });
  assert.equal(g.read().reason, "PERMISSION_DENIED");
});

test("clock reads wall time from the injected Date", () => {
  const c = new BrowserClockProvider({ Date: { now: () => Date.UTC(2026, 10, 21, 0, 5) } });
  assert.equal(c.read().timestampUtc, "2026-11-21T00:05:00.000Z");
});

test("createRealSensors wires orientation, gnss and clock", () => {
  const s = createRealSensors({});
  assert.ok(s.orientation && s.gnss && s.clock);
  assert.equal(s.gnss.read().reason, "SENSOR_UNSUPPORTED");
});
