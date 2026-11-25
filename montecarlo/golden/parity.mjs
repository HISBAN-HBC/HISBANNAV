// parity.mjs — مقارنة المختبر (montecarlo/lm.mjs) بالمنتج (estimator/) على سيناريوهات ثابتة.
// المعيار: tolerances صريحة على φ وλ وb وχ² وH، ومطابقة عدد التكرارات وعلامات التقارب والحدود.
import { levenbergMarquardt as labLM, estimate as labEstimate } from "../lm.mjs";
import { levenbergMarquardt as prodLM, estimateJoint, estimatePositionOnly } from "../../estimator/index.js";
import { SCENARIOS, buildMeasurements } from "./fixtures.mjs";

export const TOL = Object.freeze({ phiDeg: 1e-6, lamDeg: 1e-6, biasDeg: 1e-5, chi2Abs: 1e-9, chi2Rel: 1e-9, hRel: 1e-9 });
const B_MAX = 20, LOCAL = 10;

/** ملخص قابل للمقارنة لنتيجة ملاءمة. */
export function summarize(res, p0) {
  const [phi, lam, b] = res.p;
  const boundsHit = Math.abs(b) >= B_MAX - 1e-9 || Math.abs(phi - p0[0]) >= LOCAL - 1e-9 || Math.abs(lam - p0[1]) >= LOCAL - 1e-9;
  return {
    phi, lam, b, chi2: res.chi2,
    iterations: res.iterations, converged: res.converged, boundsHit,
    H: res.H.flat(),
  };
}

function compare(a, b) {
  const fails = [];
  const check = (name, ok, detail) => { if (!ok) fails.push(`${name}: ${detail}`); };
  check("phi", Math.abs(a.phi - b.phi) < TOL.phiDeg, `Δ=${Math.abs(a.phi - b.phi)}`);
  check("lam", Math.abs(a.lam - b.lam) < TOL.lamDeg, `Δ=${Math.abs(a.lam - b.lam)}`);
  check("bias", Math.abs(a.b - b.b) < TOL.biasDeg, `Δ=${Math.abs(a.b - b.b)}`);
  const dChi = Math.abs(a.chi2 - b.chi2);
  check("chi2", dChi < Math.max(TOL.chi2Abs, TOL.chi2Rel * Math.abs(a.chi2)), `Δ=${dChi}`);
  check("iterations", a.iterations === b.iterations, `${a.iterations} vs ${b.iterations}`);
  check("converged", a.converged === b.converged, `${a.converged} vs ${b.converged}`);
  check("boundsHit", a.boundsHit === b.boundsHit, `${a.boundsHit} vs ${b.boundsHit}`);
  const hOk = a.H.every((x, i) => Math.abs(x - b.H[i]) <= TOL.hRel * Math.max(1, Math.abs(x)));
  check("H", hOk, `max Δ=${Math.max(...a.H.map((x, i) => Math.abs(x - b.H[i])))}`);
  return fails;
}

/** يشغّل كل السيناريوهات ويعيد الصفوف مع الفشل إن وُجد. */
export function runParity() {
  const rows = [];
  for (const s of SCENARIOS) {
    const meas = buildMeasurements(s);
    const labMeas = meas.map((m) => ({ utcMs: m.utcMs, h: m.altitudeDeg, A: m.azimuthDeg }));
    const row = { id: s.id, labCompatible: s.labCompatible, checks: {}, fails: [] };

    if (!s.labCompatible) {
      // σ متغيرة: المختبر لا يدعمها، نكتفي بالتحقق من أن المنتج يعمل ويعطي نتيجة منتهية
      const r = estimateJoint(meas).best;
      row.checks.productOnly = { chi2: r.chi2, finite: Number.isFinite(r.chi2) };
      if (!Number.isFinite(r.chi2)) row.fails.push("productOnly: non-finite chi2");
      rows.push(row);
      continue;
    }

    // (1) LM المباشر من بدايتين، مع وبدون تثبيت الانحياز
    const starts = [[s.lat + 0.3, s.lon - 0.3, 0], [s.lat - 1.5, s.lon + 1.5, 0]];
    for (const [i, p0] of starts.entries()) {
      for (const fixB of [null, 0]) {
        const key = `lm_start${i}_${fixB === null ? "joint" : "fixed0"}`;
        const a = summarize(labLM(p0, labMeas, fixB, null), p0);
        const b = summarize(prodLM(p0, meas, { fixB }), p0);
        row.checks[key] = { lab: a, prod: b };
        row.fails.push(...compare(a, b).map((f) => `${key} ${f}`));
      }
    }

    // (2) التقدير الكامل (بدايات الشبكة) للوضعين
    const labJ = labEstimate(labMeas, null).best;
    const prodJ = estimateJoint(meas).best;
    const aJ = summarize(labJ, labJ.start ? [labJ.start.lat, labJ.start.lon, 0] : [0, 0, 0]);
    const bJ = summarize(prodJ, prodJ.start ? [prodJ.start.lat, prodJ.start.lon, 0] : [0, 0, 0]);
    row.checks.joint = { lab: aJ, prod: bJ };
    row.fails.push(...compare(aJ, bJ).map((f) => `joint ${f}`));

    const labP = labEstimate(labMeas, 0).best;
    const prodP = estimatePositionOnly(meas).best;
    const aP = summarize(labP, labP.start ? [labP.start.lat, labP.start.lon, 0] : [0, 0, 0]);
    const bP = summarize(prodP, prodP.start ? [prodP.start.lat, prodP.start.lon, 0] : [0, 0, 0]);
    row.checks.positionOnly = { lab: aP, prod: bP };
    row.fails.push(...compare(aP, bP).map((f) => `positionOnly ${f}`));

    rows.push(row);
  }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith("parity.mjs")) {
  const rows = runParity();
  let bad = 0;
  for (const r of rows) {
    const status = r.fails.length ? "FAIL" : "ok";
    if (r.fails.length) bad++;
    console.log(`${status.padEnd(5)} ${r.id}${r.labCompatible ? "" : "  (product-only)"}`);
    for (const f of r.fails) console.log(`      - ${f}`);
  }
  console.log(`\n${rows.length - bad}/${rows.length} scenarios match`);
  process.exit(bad ? 1 : 0);
}
