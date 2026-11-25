// lm.mjs — محرك التقدير المشترك (φ, λ, b_A) بـ Levenberg–Marquardt متعدد البدايات.
// مستخرج من B2 ليُعاد استخدامه في B3. يدعم تثبيت b_A (fixB) لسيناريوهات "معلوم" و"بدون معايرة".

import { solarPosition } from "../engine/hisban-engine.js";
import { cellCenters } from "../grid/hisban-grid.js";
import { rankCells, wrapDeg } from "../matcher/hisban-matcher.js";

export const SIGMA_H = 1;
export const SIGMA_A = 3;
export const B_MAX = 20;
export const LOCAL = 10;
export const K = 10;
const CELLS = cellCenters(5);

// p = [φ, λ, b]، والقياسات {utcMs, h, A} (A تحتوي الانحياز الحقيقي إن وُجد)
export function residuals(p, meas, prior = null) {
  const r = [];
  for (const m of meas) {
    const pos = solarPosition(m.utcMs, p[0], p[1]);
    r.push((m.h - pos.altitudeDeg) / SIGMA_H);
    r.push(wrapDeg(m.A - pos.azimuthDeg - p[2]) / SIGMA_A);
  }
  if (prior) r.push(p[2] / prior); // prior: b ~ N(0, σ_b²)
  return r;
}

export function jacobian(p, meas, prior = null) {
  const e = 0.01;
  const rows = [];
  for (const m of meas) {
    const hp = solarPosition(m.utcMs, p[0] + e, p[1]), hm = solarPosition(m.utcMs, p[0] - e, p[1]);
    const lp = solarPosition(m.utcMs, p[0], p[1] + e), lm = solarPosition(m.utcMs, p[0], p[1] - e);
    rows.push([-(hp.altitudeDeg - hm.altitudeDeg) / (2 * e) / SIGMA_H, -(lp.altitudeDeg - lm.altitudeDeg) / (2 * e) / SIGMA_H, 0]);
    rows.push([
      -wrapDeg(hp.azimuthDeg - hm.azimuthDeg) / (2 * e) / SIGMA_A,
      -wrapDeg(lp.azimuthDeg - lm.azimuthDeg) / (2 * e) / SIGMA_A,
      -1 / SIGMA_A,
    ]);
  }
  if (prior) rows.push([0, 0, 1 / prior]);
  return rows;
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-18) return null;
    for (let r = c + 1; r < 3; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = M[r][3];
    for (let k = r + 1; k < 3; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function inv3(M) {
  const [[a, b, c], [d, e2, f], [g, h, i]] = M;
  const A = e2 * i - f * h, B = -(d * i - f * g), C = d * h - e2 * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-14)) return null;
  const D = -(b * i - c * h), E = a * i - c * g, Fm = -(a * h - b * g);
  const G = b * f - c * e2, H = -(a * f - c * d), I = a * e2 - b * d;
  return [
    [A / det, D / det, G / det],
    [B / det, E / det, H / det],
    [C / det, Fm / det, I / det],
  ];
}

export function levenbergMarquardt(p0, meas, fixB = null, prior = null) {
  let p = p0.slice();
  if (fixB !== null) p[2] = fixB;
  let r = residuals(p, meas, prior);
  let chi = dot(r, r);
  let lam = 1e-3;
  let iters = 0;
  let converged = false;
  for (iters = 0; iters < 200; iters++) {
    const J = jacobian(p, meas, prior);
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
        // تثبيت b: صف وعمود الانحياز يصبحان وحدة وصفر
        for (let k = 0; k < 3; k++) { A[2][k] = k === 2 ? 1 : 0; A[k][2] = k === 2 ? 1 : 0; }
        gg[2] = 0;
      }
      const d = solve3(A, gg.map((x) => -x));
      if (!d) { lam *= 10; continue; }
      const pn = [
        Math.min(90, Math.max(-90, p[0] + d[0])),
        p[1] + d[1],
        fixB !== null ? fixB : Math.min(B_MAX, Math.max(-B_MAX, p[2] + d[2])),
      ];
      pn[0] = Math.min(p0[0] + LOCAL, Math.max(p0[0] - LOCAL, pn[0]));
      pn[1] = Math.min(p0[1] + LOCAL, Math.max(p0[1] - LOCAL, pn[1]));
      const rn = residuals(pn, meas, prior);
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
  // مصفوفة H = JᵀJ عند الحل
  const Jf = jacobian(p, meas, prior);
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const row of Jf) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += row[a] * row[b];
  return { p, chi2: chi, iterations: iters, converged, H };
}

// multi-start من أفضل K مرشحين للشبكة الخشنة (بدون معرفة الانحياز)
export function estimate(meas, fixB = null, prior = null) {
  const noBias = meas.map((m) => ({ utcMs: m.utcMs, altitudeDeg: m.h, azimuthDeg: m.A, sigmaAlt: SIGMA_H, sigmaAz: SIGMA_A }));
  const top = rankCells(CELLS, noBias, K);
  const runs = top.map((c) => ({ start: c, ...levenbergMarquardt([c.lat, c.lon, 0], meas, fixB, prior) }));
  runs.sort((a, b) => a.chi2 - b.chi2);
  return { best: runs[0], runs };
}
