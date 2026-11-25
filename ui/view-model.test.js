import { test } from "node:test";
import assert from "node:assert/strict";
import { statusBar, navigationScreen, diagnosticsScreen, sessionScreen, researchScreen } from "./view-model.js";

const ok = (over = {}) => ({
  status: "OK",
  estimate: { latitudeDeg: -35.0001234, longitudeDeg: 150.0004, biasDeg: 4 },
  uncertainty: { positionKm: 12.34, majorKm: 1, minorKm: 1, rho: 0.1, biasSigmaDeg: 0.5 },
  navigationState: "OBSERVABLE",
  sensorState: "STABLE",
  candidates: [{ latitudeDeg: -35, longitudeDeg: 150, biasDeg: 4, chiSquare: 0.5 }],
  diagnostics: { measurementCount: 5, chiSquare: 0.5, converged: true, driftD: 0.4, outliers: [], navigationReason: "bias and position separable", warnings: [] },
  nextMeasurementRecommendation: { code: "NONE", text: "لا توصية." },
  ...over,
});

test("status bar shows navigation and sensor separately and never a merged score", () => {
  const sb = statusBar(ok({ navigationState: "POSITION_ONLY", sensorState: "DRIFT" }));
  assert.equal(sb.navigation.value, "POSITION_ONLY");
  assert.equal(sb.sensor.value, "DRIFT");
  assert.equal("confidence" in sb, false);
  assert.equal("merged" in sb, false);
});

test("UNOBSERVABLE hides the position entirely, even if an estimate exists", () => {
  const s = navigationScreen(ok({ navigationState: "UNOBSERVABLE" }));
  assert.equal(s.showPosition, false);
  assert.equal(s.position, undefined);
});

test("POSITION_ONLY shows the position but says it is approximate", () => {
  const s = navigationScreen(ok({ navigationState: "POSITION_ONLY" }));
  assert.equal(s.showPosition, true);
  assert.match(s.message, /تقريبي/);
});

test("OBSERVABLE shows position with uncertainty and the model-only caveat", () => {
  const s = navigationScreen(ok());
  assert.equal(s.showPosition, true);
  assert.equal(s.position.uncertaintyKm, "12.3");
  assert.match(s.position.uncertaintyNote, /الانكسار/);
});

test("waiting and rejected runs make no position claim", () => {
  assert.equal(navigationScreen({ status: "WAITING", nextMeasurementRecommendation: { text: "أضف" } }).showPosition, false);
  assert.equal(navigationScreen({ status: "REJECTED" }).showPosition, false);
});

test("diagnostics marks drift as unavailable below three measurements", () => {
  const d = diagnosticsScreen(ok({ diagnostics: { ...ok().diagnostics, driftD: null } }));
  assert.match(d.driftD, /غير متاح/);
});

test("session timeline reports each step's own states", () => {
  const rows = sessionScreen([
    { count: 2, timestampUtc: "t2", result: ok({ sensorState: "INSUFFICIENT_DATA" }) },
    { count: 3, timestampUtc: "t3", result: { status: "WAITING" } },
  ]).rows;
  assert.equal(rows[0].sensor, "بيانات غير كافية");
  assert.equal(rows[1].navigation, "—");
});

test("research screen flags provisional observability keys and reports replay state", () => {
  const session = {
    sessionId: "S", schemaVersion: 1, measurements: [{}],
    algorithmConfig: { driftDThreshold: 3, observabilityBiasSigmaDeg: 2 },
  };
  const r = researchScreen(session, { replay: { reproducible: false, diffs: ["bias"] } });
  assert.equal(r.config.find((c) => c.key === "observabilityBiasSigmaDeg").provisional, true);
  assert.equal(r.config.find((c) => c.key === "driftDThreshold").provisional, false);
  assert.match(r.replay, /غير قابلة/);
});
