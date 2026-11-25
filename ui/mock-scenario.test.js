import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMockStream } from "./mock-scenario.js";
import { runNavigation, RUN_STATUS } from "../pipeline/index.js";

const START = Date.UTC(2026, 10, 10, 1, 46);
const BASE = { lat: -35, lon: 150, startUtcMs: START };

test("mock sensor stream feeds the pipeline and recovers the planted bias", () => {
  const { measurements, skipped } = buildMockStream({ ...BASE, count: 6, stepMin: 20, compassBiasDeg: 4 });
  assert.equal(skipped.length, 0);
  const r = runNavigation(measurements);
  assert.equal(r.status, RUN_STATUS.OK);
  assert.ok(Math.abs(r.estimate.biasDeg - 4) < 0.05, `bias ${r.estimate.biasDeg}`);
});

test("a dropped compass reading is skipped and named, not invented", () => {
  const { measurements, skipped } = buildMockStream({ ...BASE, count: 6, stepMin: 20, dropAt: 2 });
  assert.equal(measurements.length, 5);
  assert.deepEqual(skipped, [{ index: 2, reason: "SENSOR_UNAVAILABLE: compass" }]);
});

test("a 10 degree-per-hour drift in the mock stream is detected by the pipeline", () => {
  const { measurements } = buildMockStream({ ...BASE, count: 9, stepMin: 15, driftDegPerHour: 10 });
  assert.equal(runNavigation(measurements).sensorState, "DRIFT");
});
