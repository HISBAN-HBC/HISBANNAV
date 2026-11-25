// lm.js — ملاءمة Levenberg–Marquardt للمعاملات (φ, λ, b_A).
// كل قياس يحمل σ الخاصة به (sigmaAlt, sigmaAz بالدرجات)، ولا توجد قيم مخفية.
// تُمرَّر الحدود (bounds) صراحة، والقيم الافتراضية موثقة أدناه.

import { solarPosition } from "../../engine/hisban-engine.js";
import { wrapDeg } from "../../matcher/hisban-matcher.js";
import { solve3 } from "../../estimator/linalg.js";

/** حدود افتراضية: انحياز ±20°، ونافذة محلية ±10° حول البداية، و200 تكرار كحد أقصى. */
export const DEFAULT_BOUNDS = Object.freeze({ bMaxDeg: 20, localDeg: 10, maxIter: 200 });

/** يتحقق من σ لكل قياس؛ لا توجد قيم افتراضية. */
export function requireSigmas(meas) {
  if (!Array.isArray(meas) || meas.length === 0) throw new Error("estimator: measurements array is required");
  for (const m of meas) {
    if (!(Number.isFinite(m.sigmaAlt) && m.sigmaAlt > 0) || !(Number.isFinite(m.sigmaAz) && m.sigmaAz > 0)) {
      throw new Error("estimator: sigmaAlt and sigmaAz (degrees, > 0) are required on every measurement");
    }
  }
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** المخلفات المعيارية: [قناة الارتفاع، قناة السمت] لكل قياس، وإضافياً حد prior على b إن وُجد. */
export function residuals(p, meas, priorSigmaB = null) {
  const r = [];
  for (const m of meas) {
    const pos = solarPosition(m.utcMs, p[0], p[1]);
    r.push((m.altitudeDeg - pos.altitudeDeg) / m.sigmaAlt);
    r.push((m.azimuthDeg - pos.azimuthDeg - p[2]) / m.sigmaAz);
  }
  if (priorSigmaB) r.push(p[2] / priorSigmaB);
  return r;
}

/** مصفوفة Jacobian للمخلفات (صفوف = المخلفات، أعمدة = φ، λ، b). */
export function jacobian(p, meas, priorSigmaB = null) {
  const e = 0.01;
  const rows = [];
  for (const m of meas) {
    const hp = solarPosition(m.utcMs, p[0] + e, p[1]), hm = solarPosition(m.utcMs, p[0] - e, p[1]);
    const lp = solarPosition(m.utcMs, p[0], p[1] + e), lmv = solarPosition(m.utcMs, p[0], p[1] - e);
    rows.push([
      -(hp.altitudeDeg - hm.altitudeDeg) / (2 * e) / m.sigmaAlt,
      -(lp.altitudeDeg - lmv.altitudeDeg) / (2 * e) / m.sigmaAlt,
      0,
    ]);
    rows.push([
      -(hp.azimuthDeg - hm.azimuthDeg) / (2 * e) / m.sigmaAz,
      -(lp.azimuthDeg - lmv.azimuthDeg) / (2 * e) / m.sigmaAz,
      -1 / m.sigmaAz,
    ]);
  }
  if (priorSigmaB) rows.push([0, 0, 1 / priorSigmaB]);
  return rows;
}

/**
 * ملاءمة LM من نقطة بداية p0 = [φ, λ, b].
 * fixB: إن كان رقماً، يُثبَّت الانحياز عنده (Position-only عند 0).
 * priorSigmaB: إن كان رقماً، يُضاف حد prior غاوسي على b.
 * يعيد { p, chi2, iterations, converged, H } حيث H = JᵀJ عند الحل.
 */
export function levenbergMarquardt(p0, meas, { fixB = null, priorSigmaB = null, bounds = DEFAULT_BOUNDS } = {}) {
  requireSigmas(meas);
  const { bMaxDeg, localDeg, maxIter } = { ...DEFAULT_BOUNDS, ...bounds };
  let p = p0.slice();
  if (fixB !== null) p[2] = fixB;
  let r = residuals(p, meas, priorSigmaB);
  let chi = dot(r, r);
  let lam = 1e-3;
  let iters = 0;
  let converged = false;
  for (iters = 0; iters < maxIter; iters++) {
    const J = jacobian(p, meas, priorSigmaB);
    const JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const g = [0, 0, 0];
    for (let i = 0; i < r.length; i++) {
      for (let a = 0; a < 3; a++) {
        g[a] += J[i][a] * r[i];
        for (let b = 0; b < 3; b++) JtJ[a][b] += J[i][a] * J[i][b];
      }
    }
    let accepted = false;
    for (let tries = 0; tries < 30 && !accepted; tries++) {
      const A = JtJ.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lam) + 1e-12 : x)));
      const gg = g.slice();
      if (fixB !== null) {
        // تثبيت b: صف وعمود الانحياز يصبحان وحدة وصفراً
        for (let k = 0; k < 3; k++) { A[2][k] = k === 2 ? 1 : 0; A[k][2] = k === 2 ? 1 : 0; }
        gg[2] = 0;
      }
      const d = solve3(A, gg.map((x) => -x));
      if (!d) { lam *= 10; continue; }
      const pn = [
        Math.min(90, Math.max(-90, p[0] + d[0])),
        p[1] + d[1],
        fixB !== null ? fixB : Math.min(bMaxDeg, Math.max(-bMaxDeg, p[2] + d[2])),
      ];
      pn[0] = Math.min(p0[0] + localDeg, Math.max(p0[0] - localDeg, pn[0]));
      pn[1] = Math.min(p0[1] + localDeg, Math.max(p0[1] - localDeg, pn[1]));
      const rn = residuals(pn, meas, priorSigmaB);
      const chin = dot(rn, rn);
      if (chin < chi) {
        const stepSize = Math.hypot(pn[0] - p[0], pn[1] - p[1], pn[2] - p[2]);
        const decrease = chi - chin;
        p = pn; r = rn; chi = chin;
        lam = Math.max(lam / 3, 1e-12);
        accepted = true;
        if (decrease < 1e-9 * (1 + chi) && stepSize < 1e-5) converged = true;
      } else {
        lam *= 4;
      }
    }
    if (!accepted || converged) {
      if (!accepted) converged = converged || chi < 1e-6;
      break;
    }
  }
  const Jf = jacobian(p, meas, priorSigmaB);
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const row of Jf) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += row[a] * row[b];
  return { p, chi2: chi, iterations: iters, converged, H };
}
