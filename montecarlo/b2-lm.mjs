// b2-lm.mjs — المرحلة B2: تقدير مشترك (φ, λ, b_A) بـ Levenberg–Marquardt متعدد البدايات.
// الاختبار الأول: بيانات مثالية بلا ضوضاء، b_A ∈ {−15,…,15}.
// التشغيل: node b2-lm.mjs

import { solarPosition } from "../engine/hisban-engine.js";
import { cellCenters } from "../grid/hisban-grid.js";
import { rankCells, wrapDeg } from "../matcher/hisban-matcher.js";
import { haversineKm } from "../core/hisban-core.js";

const SIGMA_H = 1;
const SIGMA_A = 3;
const B_MAX = 20;
const LOCAL = 10; // نافذة جغرافية حول كل بداية (درجات)
const K = 10;
const CELLS = cellCenters(5);
const KM = 111.32;

const CASES = [
  { name: "الجزائر N=4 Δ120", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360] },
  { name: "الجزائر N=5 Δ60", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 60, 120, 180, 240] },
  { name: "كامبالا N=3 Δ120", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20), off: [0, 120, 240] },
  // ضوابط: Position-only في B1 (يجب أن تكون غير قابلة للمعايرة مع الضوضاء)
  { name: "[ضابط] الجزائر N=2 Δ60", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 60] },
  { name: "[ضابط] ترومسو N=2 Δ60", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21), off: [0, 60] },
];

// ---------- البواقي ----------
// p = [φ, λ, b]، والقياسات {utcMs, h, A}
function residuals(p, meas) {
  const r = [];
  for (const m of meas) {
    const pos = solarPosition(m.utcMs, p[0], p[1]);
    r.push((m.h - pos.altitudeDeg) / SIGMA_H);
    r.push(wrapDeg(m.A - pos.azimuthDeg - p[2]) / SIGMA_A);
  }
  return r;
}

// الجاكوبيان: مشتقات عددية للموقع، وتحليلية للانحياز (∂r_A/∂b = −1/σA)
function jacobian(p, meas) {
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
  return rows;
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// حل نظام 3×3 بالحذف الغاوسي
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

// ---------- LM من بداية واحدة مع حدود ----------
function levenbergMarquardt(p0, meas) {
  let p = p0.slice();
  let r = residuals(p, meas);
  let chi = dot(r, r);
  let lam = 1e-3;
  let iters = 0;
  let converged = false;
  let J, JtJ;
  for (iters = 0; iters < 200; iters++) {
    J = jacobian(p, meas);
    JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
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
      const d = solve3(A, g.map((x) => -x));
      if (!d) { lam *= 10; continue; }
      const pn = [
        Math.min(90, Math.max(-90, p[0] + d[0])),
        p[1] + d[1],
        Math.min(B_MAX, Math.max(-B_MAX, p[2] + d[2])),
      ];
      pn[0] = Math.min(p0[0] + LOCAL, Math.max(p0[0] - LOCAL, pn[0]));
      pn[1] = Math.min(p0[1] + LOCAL, Math.max(p0[1] - LOCAL, pn[1]));
      const rn = residuals(pn, meas);
      const chin = dot(rn, rn);
      if (chin < chi) {
        const stepSize = Math.hypot(pn[0] - p[0], pn[1] - p[1], pn[2] - p[2]);
        const decrease = chi - chin;
        p = pn; r = rn; chi = chin;
        lam = Math.max(lam / 3, 1e-12);
        accepted = true;
        if (decrease < 1e-9 * (1 + chi) && stepSize < 1e-5) { converged = true; }
      } else {
        lam *= 4;
      }
    }
    if (!accepted || converged) {
      if (!accepted) converged = converged || chi < 1e-6; // لا تحسن ممكن: التقارب عملياً
      break;
    }
  }
  return { p, chi2: chi, iterations: iters, converged, H: JtJ };
}

// ---------- multi-start ----------
function estimate(meas) {
  const noBias = meas.map((m) => ({ utcMs: m.utcMs, altitudeDeg: m.h, azimuthDeg: m.A, sigmaAlt: SIGMA_H, sigmaAz: SIGMA_A }));
  const top = rankCells(CELLS, noBias, K);
  const runs = top.map((c) => {
    const res = levenbergMarquardt([c.lat, c.lon, 0], meas);
    return { start: c, ...res };
  });
  runs.sort((a, b) => a.chi2 - b.chi2);
  return { best: runs[0], runs, topCell: top[0] };
}

// ---------- الاختبار بلا ضوضاء ----------
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "∞");
const out = [];
out.push(`B2 — بيانات مثالية بلا ضوضاء، multi-start LM (K=${K}، نافذة ±${LOCAL}°، |b| ≤ ${B_MAX}°)\n`);
for (const c of CASES) {
  out.push(`## ${c.name}`);
  out.push("| b_A الحقيقي | φ̂ | λ̂ | b̂ | Δموقع (كم) | Δb (°) | χ² | تكرارات | تقارب | علامات |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  const base = c.day + 7 * 3_600_000;
  const times = c.off.map((m) => base + m * 60_000);
  for (const bTrue of [-15, -10, -5, 0, 5, 10, 15]) {
    const meas = times.map((t) => {
      const p = solarPosition(t, c.lat, c.lon);
      return { utcMs: t, h: p.altitudeDeg, A: p.azimuthDeg + bTrue };
    });
    const { best, runs } = estimate(meas);
    const dPos = haversineKm(best.p[0], best.p[1], c.lat, c.lon);
    const dB = best.p[2] - bTrue;
    const flags = [];
    if (!best.converged) flags.push("عدم تقارب");
    if (Math.abs(best.p[2]) >= B_MAX - 1e-6) flags.push("حد b");
    if (Math.abs(best.p[0] - runs[0].start.lat) >= LOCAL - 1e-6 || Math.abs(best.p[1] - runs[0].start.lon) >= LOCAL - 1e-6) flags.push("حد الموقع");
    const distinct = 1 + runs.slice(1).filter((r) => r.chi2 < best.chi2 + 1e-3 && haversineKm(r.p[0], r.p[1], best.p[0], best.p[1]) > 50).length;
    if (distinct > 1) flags.push(`حلول متعددة (${distinct})`);
    out.push(`| ${bTrue} | ${fmt(best.p[0], 3)} | ${fmt(best.p[1], 3)} | ${fmt(best.p[2], 3)} | ${fmt(dPos, 1)} | ${fmt(dB, 3)} | ${best.chi2.toExponential(1)} | ${best.iterations} | ${best.converged ? "نعم" : "لا"} | ${flags.join("، ") || "—"} |`);
  }
  out.push("");
}
console.log(out.join("\n"));
