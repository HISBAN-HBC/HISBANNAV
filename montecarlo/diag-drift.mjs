// diag-drift.mjs — تشخيص انحراف 5°/س في الإعداد القوي: هل يصل b̂ للحد؟ وما شكل المخلفات؟
import { solarPosition } from "../engine/hisban-engine.js";
import { haversineKm } from "../core/hisban-core.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { estimate, residuals, inv3, SIGMA_A, B_MAX } from "./lm.mjs";

const TRIALS = Number(process.env.TRIALS ?? 300);
const cfg = { lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360, 480] };
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gaussOf = (rng) => () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function trial(drift, rng, gauss) {
  const base = cfg.day + 7 * 3_600_000;
  const times = cfg.off.map((m) => base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, cfg.lat, cfg.lon));
  const b0 = (rng() * 2 - 1) * 10;
  const meas = times.map((t, k) => {
    const bk = b0 + (drift * (t - base)) / 3_600_000;
    return { utcMs: t, h: truth[k].altitudeDeg + gauss(), A: truth[k].azimuthDeg + bk + gauss() * SIGMA_A };
  });
  const { best } = estimate(meas, null);
  const r = residuals(best.p, meas);
  const chi = r.reduce((s, x) => s + x * x, 0);
  const t0 = meas[0].utcMs;
  const tH = meas.map((m) => (m.utcMs - t0) / 3_600_000);
  const rA = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, best.p[0], best.p[1]).azimuthDeg - best.p[2]));
  const k = meas.length, tb = tH.reduce((s, x) => s + x, 0) / k, rb = rA.reduce((s, x) => s + x, 0) / k;
  const Stt = tH.reduce((s, x) => s + (x - tb) ** 2, 0);
  const slope = tH.reduce((s, x, i) => s + (x - tb) * (rA[i] - rb), 0) / Stt;
  const D = Math.abs(slope) / (SIGMA_A / Math.sqrt(Stt));
  const Hinv = inv3(best.H);
  const sigB = Hinv ? Math.sqrt(Math.max(0, Hinv[2][2])) : Infinity;
  // حالة المصفوفة: نسبة أكبر إلى أصغر عنصر قطري بعد التحجيم
  const d = [0, 1, 2].map((i) => Math.sqrt(best.H[i][i]));
  const scaled = best.H.map((row, i) => row.map((v, j) => v / (d[i] * d[j])));
  const diagMin = Math.min(...[0, 1, 2].map((i) => scaled[i][i]));
  const condProxy = Math.max(...scaled.flat().map(Math.abs)) / Math.max(1e-12, Math.abs(diagMin));
  return {
    bHat: best.p[2], atBound: Math.abs(best.p[2]) >= B_MAX - 0.5, chi, D, sigB,
    EA: haversineKm(best.p[0], best.p[1], cfg.lat, cfg.lon), condProxy, b0,
  };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]; };
const rows = [];
for (const drift of [0, 1, 3, 5]) {
  const rng = mulberry32(777 + drift); const gauss = gaussOf(rng);
  const R = Array.from({ length: TRIALS }, () => trial(drift, rng, gauss));
  rows.push({
    drift,
    atBound: R.filter((x) => x.atBound).length / TRIALS,
    bAbsMed: med(R.map((x) => Math.abs(x.bHat))),
    chiMed: med(R.map((x) => x.chi)),
    DMed: med(R.map((x) => x.D)),
    DgtThree: R.filter((x) => x.D >= 3).length / TRIALS,
    sigBMed: med(R.map((x) => x.sigB)),
    condMed: med(R.map((x) => x.condProxy)),
    EP95: p95(R.map((x) => x.EA)),
    bErrMed: med(R.map((x) => Math.abs(x.bHat - x.b0))),
  });
}
const f = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : "—";
console.log("| انحراف °/س | b̂ عند الحد | \\|b̂\\| وسيط | χ² وسيط | D وسيط | D≥3 | σ_b وسيط | مؤشر الحالة | خطأ b̂ وسيط | P95 E_A (كم) |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.drift} | ${(r.atBound * 100).toFixed(1)}% | ${f(r.bAbsMed)} | ${f(r.chiMed)} | ${f(r.DMed, 2)} | ${(r.DgtThree * 100).toFixed(1)}% | ${f(r.sigBMed, 2)} | ${f(r.condMed, 0)} | ${f(r.bErrMed)} | ${f(r.EP95, 0)} |`);
