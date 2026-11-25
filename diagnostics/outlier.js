// outlier.js — إحصاءة الشذوذ لكل قياس: O_i (تحسن χ² عند الحذف)، t_i (باقٍ معياري خارجي)، D₋ᵢ، و h_ii.
// لا تحذف شيئاً: الناتج يُستخدم للتحذير فقط.

import { jacobian, requireSigmas, estimateJoint } from "../estimator/index.js";
import { inv3 } from "../estimator/linalg.js";
import { residuals } from "../estimator/lm.js";
import { driftD } from "./drift.js";

export function outlierStats(meas, best) {
  requireSigmas(meas);
  const N = meas.length;
  const r = residuals(best.p, meas); // قناتان لكل قياس
  const J = jacobian(best.p, meas);
  const JtJ = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
  const Ji = inv3(JtJ);
  if (!Ji) throw new Error("diagnostics: singular Jacobian in outlier statistics");
  const lev = (row) => {
    let s = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s += row[a] * Ji[a][b] * row[b];
    return s;
  };
  const dof = 2 * (N - 1) - 3;
  const out = [];
  for (let i = 0; i < N; i++) {
    const sub = meas.filter((_, j) => j !== i);
    const bsub = estimateJoint(sub).best;
    const sigMinus = Math.sqrt(bsub.chi2 / dof);
    const h = lev(J[2 * i + 1]);
    const t = r[2 * i + 1] / (sigMinus * Math.sqrt(Math.max(1e-9, 1 - h)));
    out.push({ index: i, O: best.chi2 - bsub.chi2, t, Dminus: driftD(bsub.p, sub).D, h });
  }
  return out;
}
