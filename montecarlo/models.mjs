// models.mjs — M0 = (φ,λ,b0) و M1 = (φ,λ,b0,ḃ)، ومعالجات: drop-one، نقطة الفصل، Hessian لـḃ.
import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { estimate, SIGMA_H, SIGMA_A } from "./lm.mjs";

export const fitM0 = (meas) => estimate(meas, null).best; // {p, chi2, H}

// زمن النموذج يُقاس بالساعات من t0 (منتصف القياسات) لتقليل الترابط بين b0 و ḃ
export function meanTimeMs(meas) { return meas.reduce((s, m) => s + m.utcMs, 0) / meas.length; }

function res1(p, meas, t0ms) {
  const out = [];
  for (const m of meas) {
    const pos = solarPosition(m.utcMs, p[0], p[1]);
    const th = (m.utcMs - t0ms) / 3_600_000;
    out.push((m.h - pos.altitudeDeg) / SIGMA_H);
    out.push(wrapDeg(m.A - pos.azimuthDeg - p[2] - p[3] * th) / SIGMA_A);
  }
  return out;
}
const dotv = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function jac1(p, meas, t0ms, r0) {
  const e = 0.01;
  const cols = [];
  for (let j = 0; j < 4; j++) {
    const q = [...p]; q[j] += e;
    const r = res1(q, meas, t0ms);
    cols.push(r.map((x, i) => (x - r0[i]) / e));
  }
  return r0.map((_, i) => cols.map((c) => c[i])); // [rows][4]
}

// قلب مصفوفة 4×4 (جاوس-جوردان)
function inv4(M) {
  const n = 4;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c];
    if (!(Math.abs(d) > 1e-14)) return null;
    for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = A[r][c];
      for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r) => r.slice(n));
}

// M1 بـ Levenberg–Marquardt من عدة بدايات لـḃ
export function fitM1(meas, p0, t0ms, starts = [-3, 0, 3]) {
  let best = null;
  for (const bd0 of starts) {
    let p = [p0[0], p0[1], p0[2], bd0];
    let r = res1(p, meas, t0ms);
    let chi = dotv(r, r);
    let lam = 1e-2;
    for (let it = 0; it < 60; it++) {
      const J = jac1(p, meas, t0ms, r);
      const JTJ = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
      const JTr = Array.from({ length: 4 }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
      let accepted = false;
      for (let tr = 0; tr < 12 && !accepted; tr++) {
        const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-12 : v)));
        const Ai = inv4(A);
        if (!Ai) { lam *= 4; continue; }
        const d = Ai.map((row) => -dotv(row, JTr));
        const pn = p.map((x, i) => x + d[i]);
        const rn = res1(pn, meas, t0ms);
        const cn = dotv(rn, rn);
        if (cn < chi) {
          const rel = (chi - cn) / Math.max(chi, 1e-12);
          p = pn; r = rn; chi = cn; lam = Math.max(lam / 3, 1e-9); accepted = true;
          if (rel < 1e-9) { it = 999; }
        } else lam *= 4;
      }
      if (!accepted) break;
    }
    const J = jac1(p, meas, t0ms, r);
    const JTJ = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Cov = inv4(JTJ);
    const sigBd = Cov ? Math.sqrt(Math.max(0, Cov[3][3])) : Infinity;
    const cand = { p, chi2: chi, sigBd };
    if (!best || cand.chi2 < best.chi2) best = cand;
  }
  return best;
}

// اتساق المخلفات: ميل السمت بالنسبة للزمن (مرجع D كما في gate-sim)
export function Dstat(meas, p) {
  const t0 = meas[0].utcMs;
  const tH = meas.map((m) => (m.utcMs - t0) / 3_600_000);
  const rA = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, p[0], p[1]).azimuthDeg - p[2]));
  const k = meas.length;
  const tb = tH.reduce((s, x) => s + x, 0) / k, rb = rA.reduce((s, x) => s + x, 0) / k;
  const Stt = tH.reduce((s, x) => s + (x - tb) ** 2, 0);
  if (!(Stt > 0)) return 0;
  const slope = tH.reduce((s, x, i) => s + (x - tb) * (rA[i] - rb), 0) / Stt;
  return Math.abs(slope) / (SIGMA_A / Math.sqrt(Stt));
}

// نقطة الفصل: هل يفسّر انحياز واحد لكل جزء (قبل/بعد) البواقي أفضل بوضوح؟ ΔJ بوحدات σ_A²
export function changePoint(meas, p) {
  const rA = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, p[0], p[1]).azimuthDeg - p[2]));
  const n = rA.length;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const ssf = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0); };
  const full = ssf(rA);
  let best = 0;
  for (let c = 2; c <= n - 2; c++) {
    const split = ssf(rA.slice(0, c)) + ssf(rA.slice(c));
    best = Math.max(best, (full - split) / SIGMA_A ** 2);
  }
  return best;
}

// Drop-one: O_i = χ²_full − χ²_{-i}، و D_{-i} عند أكبر O_i
export function dropOne(meas, fullBest) {
  let Omax = -Infinity, idx = -1, Dm = NaN;
  for (let i = 0; i < meas.length; i++) {
    const sub = meas.filter((_, j) => j !== i);
    const b = fitM0(sub);
    const O = fullBest.chi2 - b.chi2;
    if (O > Omax) { Omax = O; idx = i; Dm = Dstat(sub, b.p); }
  }
  return { Omax, idx, Dminus: Dm };
}
