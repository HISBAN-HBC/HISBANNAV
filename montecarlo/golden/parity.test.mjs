// parity.test.mjs — ثلاثة فحوص: التكافؤ الحي مع المختبر، والانحدار الذهبي، وكشف العطب المتعمَّد.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { runParity, TOL, summarize } from "./parity.mjs";
import { levenbergMarquardt as prodLM } from "../../estimator/index.js";
import { SCENARIOS, buildMeasurements } from "./fixtures.mjs";
import { estimateJoint, estimatePositionOnly } from "../../estimator/index.js";

const rows = runParity();

for (const r of rows) {
  test(`live parity with lab LM: ${r.id}`, () => {
    assert.deepEqual(r.fails, [], r.fails.join("\n"));
  });
}

const golden = JSON.parse(readFileSync(new URL("./parity-golden.json", import.meta.url), "utf8"));
for (const g of golden.scenarios) {
  test(`golden regression: ${g.id}`, () => {
    const row = rows.find((r) => r.id === g.id);
    assert.ok(row, "scenario missing from fixtures");
    const pj = row.checks.joint.prod, pp = row.checks.positionOnly.prod;
    for (const [label, got, want] of [["joint", pj, g.joint], ["positionOnly", pp, g.positionOnly]]) {
      assert.ok(Math.abs(got.phi - want.phi) < TOL.phiDeg, `${label} phi drift`);
      assert.ok(Math.abs(got.lam - want.lam) < TOL.lamDeg, `${label} lam drift`);
      assert.ok(Math.abs(got.b - want.b) < TOL.biasDeg, `${label} bias drift`);
      assert.ok(Math.abs(got.chi2 - want.chi2) < Math.max(TOL.chi2Abs, TOL.chi2Rel * Math.abs(want.chi2)), `${label} chi2 drift`);
      assert.equal(got.iterations, want.iterations, `${label} iterations`);
      assert.equal(got.converged, want.converged, `${label} converged`);
      assert.equal(got.boundsHit, want.boundsHit, `${label} boundsHit`);
    }
  });
}

test("a planted azimuth-wrap bug is caught by parity (test is not blind)", async () => {
  const mutantSrc = readFileSync(new URL("../../estimator/lm.js", import.meta.url), "utf8")
    .replace('from "../engine/hisban-engine.js"', 'from "../../engine/hisban-engine.js"')
    .replace('from "../matcher/hisban-matcher.js"', 'from "../../matcher/hisban-matcher.js"')
    .replace('from "./linalg.js"', 'from "../../estimator/linalg.js"')
    .replace("wrapDeg(m.azimuthDeg - pos.azimuthDeg - p[2]) / m.sigmaAz", "(m.azimuthDeg - pos.azimuthDeg - p[2]) / m.sigmaAz")
    .replace("-wrapDeg(hp.azimuthDeg - hm.azimuthDeg)", "-(hp.azimuthDeg - hm.azimuthDeg)")
    .replace("-wrapDeg(lp.azimuthDeg - lmv.azimuthDeg)", "-(lp.azimuthDeg - lmv.azimuthDeg)");
  assert.notEqual(mutantSrc, readFileSync(new URL("../../estimator/lm.js", import.meta.url), "utf8"), "mutation applied");
  writeFileSync(new URL("./lm-mutant.js", import.meta.url), mutantSrc);
  const { levenbergMarquardt: mutLM } = await import("./lm-mutant.js");
  const { levenbergMarquardt: labLM } = await import("../lm.mjs");
  const s = SCENARIOS.find((x) => x.id === "azimuth_wrap_south");
  const meas = buildMeasurements(s);
  const labMeas = meas.map((m) => ({ utcMs: m.utcMs, h: m.altitudeDeg, A: m.azimuthDeg }));
  const p0 = [s.lat + 0.3, s.lon - 0.3, 0];
  const a = summarize(labLM(p0, labMeas, null, null), p0);
  const b = summarize(mutLM(p0, meas, { fixB: null }), p0);
  const diverged = Math.abs(a.b - b.b) > TOL.biasDeg || Math.abs(a.chi2 - b.chi2) > TOL.chi2Abs;
  assert.ok(diverged, "mutant without wrap must diverge from the reference");
});
