// models2.mjs — LM عام، M2 (قفزة عند نقطة فصل c)، واختيار النموذج بـAICc.
import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { SIGMA_H, SIGMA_A } from "./lm.mjs";

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function invN(M) {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c];
    if (!(Math.abs(d) > 1e-14)) return null;
    for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r) => r.slice(n));
}

// LM عام مع مشتقات عددية؛ resFn(p) → متجه المخلفات المعيارية
export function lmGeneric(resFn, p0, maxIt = 60) {
  let p = [...p0];
  let r = resFn(p);
  let chi = dot(r, r);
  const n = p.length;
  let lam = 1e-2;
  for (let it = 0; it < maxIt; it++) {
    const e = 0.01;
    const J = r.map(() => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const q = [...p]; q[j] += e;
      const rq = resFn(q);
      for (let i = 0; i < r.length; i++) J[i][j] = (rq[i] - r[i]) / e;
    }
    const JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const JTr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let accepted = false;
    for (let tr = 0; tr < 12 && !accepted; tr++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-12 : v)));
      const Ai = invN(A);
      if (!Ai) { lam *= 4; continue; }
      const d = Ai.map((row) => -dot(row, JTr));
      const pn = p.map((x, i) => x + d[i]);
      const rn = resFn(pn);
      const cn = dot(rn, rn);
      if (cn < chi) {
        const rel = (chi - cn) / Math.max(chi, 1e-12);
        p = pn; r = rn; chi = cn; lam = Math.max(lam / 3, 1e-9); accepted = true;
        if (rel < 1e-9) it = maxIt;
      } else lam *= 4;
    }
    if (!accepted) break;
  }
  const J = r.map(() => new Array(n).fill(0));
  const e = 0.01;
  for (let j = 0; j < n; j++) { const q = [...p]; q[j] += e; const rq = resFn(q); for (let i = 0; i < r.length; i++) J[i][j] = (rq[i] - r[i]) / e; }
  const JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
  return { p, chi2: chi, cov: invN(JTJ) };
}

// قياس i: الحالة = (φ,λ,b_offset-model) ; t0 بالمللي ثانية
export function resM1(meas, t0ms) {
  return (p) => {
    const out = [];
    for (const m of meas) {
      const pos = solarPosition(m.utcMs, p[0], p[1]);
      const th = (m.utcMs - t0ms) / 3_600_000;
      out.push((m.h - pos.altitudeDeg) / SIGMA_H);
      out.push(wrapDeg(m.A - pos.azimuthDeg - p[2] - p[3] * th) / SIGMA_A);
    }
    return out;
  };
}
export function resM2(meas, c) {
  return (p) => {
    const out = [];
    meas.forEach((m, k) => {
      const pos = solarPosition(m.utcMs, p[0], p[1]);
      const b = k < c ? p[2] : p[3];
      out.push((m.h - pos.altitudeDeg) / SIGMA_H);
      out.push(wrapDeg(m.A - pos.azimuthDeg - b) / SIGMA_A);
    });
    return out;
  };
}

export function fitM1(meas, p0, t0ms) {
  let best = null;
  for (const bd0 of [-3, 0, 3]) {
    const r = lmGeneric(resM1(meas, t0ms), [p0[0], p0[1], p0[2], bd0]);
    if (!best || r.chi2 < best.chi2) best = r;
  }
  best.sigBd = best.cov ? Math.sqrt(Math.max(0, best.cov[3][3])) : Infinity;
  return best;
}

// M2: تجريب كل c ∈ {2..N−2}، لكل c أفضل بداية، ثم اختيار أقل χ²
export function fitM2(meas, p0) {
  const N = meas.length;
  let best = null;
  for (let c = 2; c <= N - 2; c++) {
    for (const d of [-6, 6]) {
      const r = lmGeneric(resM2(meas, c), [p0[0], p0[1], p0[2], p0[2] + d]);
      if (!best || r.chi2 < best.chi2) best = { ...r, c };
    }
  }
  return best;
}

// اختيار النموذج بـAICc؛ n = عدد المخلفات (2N)، k = عدد المعاملات (M2 يُحسب c معاملاً)
export function selectAICc(N, chi0, chi1, chi2) {
  const n = 2 * N;
  const aicc = (chi, k) => chi + 2 * k + (2 * k * (k + 1)) / (n - k - 1);
  const a = { M0: aicc(chi0, 3), M1: aicc(chi1, 4), M2: aicc(chi2, 5) };
  const order = Object.entries(a).sort((x, y) => x[1] - y[1]);
  return { best: order[0][0], margin: order[1][1] - order[0][1], a };
}
