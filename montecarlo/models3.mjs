// models3.mjs — إحصاءة الشذوذ المعيارية: t_i = r_i / (σ̂_(−i) √(1−h_ii))، مع O_i و D₋ᵢ لكل قياس.
import { residuals, jacobian, inv3 } from "./lm.mjs";
import { fitM0, Dstat } from "./models.mjs";

// لكل قياس i: O_i (تحسن χ² عند الحذف)، t_i (باقٍ معياري)، D₋ᵢ (الاتجاه بعد الحذف)، h_ii (الرافعة)
export function outlierStats(meas, best) {
  const N = meas.length;
  const r = residuals(best.p, meas); // 2N عناصر معيارية: قناة الارتفاع ثم السمت لكل قياس
  const J = jacobian(best.p, meas); // 2N×3 بنفس الترتيب
  const JTJ = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
  const Ji = inv3(JTJ);
  const lev = (row) => {
    let s = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s += row[a] * Ji[a][b] * row[b];
    return s;
  };
  const dof = 2 * (N - 1) - 3;
  const out = [];
  for (let i = 0; i < N; i++) {
    const sub = meas.filter((_, j) => j !== i);
    const bsub = fitM0(sub);
    const sigMinus = Math.sqrt(bsub.chi2 / dof);
    const h = Ji ? lev(J[2 * i + 1]) : 0;
    const zi = r[2 * i + 1];
    const t = zi / (sigMinus * Math.sqrt(Math.max(1e-9, 1 - h)));
    out.push({ O: best.chi2 - bsub.chi2, t, D: Dstat(sub, bsub.p), h });
  }
  return out;
}
