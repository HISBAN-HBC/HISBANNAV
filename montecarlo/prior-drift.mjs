// prior-drift.mjs
//  (1) حساسية prior على b_A ~ N(0, σ_b²): σ_b ∈ {بدون prior, 2, 5, 10}، مع تصنيف الانحياز الحقيقي.
//  (2) انحراف زمني ḃ ∈ {0, 0.5, 1, 2, 3, 5}°/س، مع تحليل مخلفات السمت واختبار كاشف للانحراف.
// التشغيل: TRIALS=300 node prior-drift.mjs

import { writeFileSync } from "node:fs";
import { solarPosition } from "../engine/hisban-engine.js";
import { haversineKm } from "../core/hisban-core.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { estimate, SIGMA_H, SIGMA_A, B_MAX } from "./lm.mjs";

const TRIALS = Number(process.env.TRIALS ?? 300);
const B_RANGE = 10;

const CASES = [
  { name: "الجزائر N=4 Δ120", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360] },
  { name: "الجزائر N=5 Δ60", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 60, 120, 180, 240] },
  { name: "كامبالا N=3 Δ120", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20), off: [0, 120, 240] },
  { name: "[ضابط] ترومسو N=2 Δ60", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21), off: [0, 60] },
];
const PRIORS = [null, 2, 5, 10];
const DRIFTS = [0, 0.5, 1, 2, 3, 5];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussFactory(rng) {
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "∞");
const quant = (arr, q) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// يُنفَّذ لكل تجربة: يولّد الحقيقة، يقدّر، ويعيد المقاييس
function trialSet(site, { prior = null, drift = 0, noise = true, seed }) {
  const base = site.day + 7 * 3_600_000;
  const times = site.off.map((m) => base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, site.lat, site.lon));
  const rng = mulberry32(seed);
  const gauss = gaussFactory(rng);
  const rows = [];
  for (let trial = 0; trial < TRIALS; trial++) {
    const b0 = (rng() * 2 - 1) * B_RANGE;
    const biasAt = times.map((t) => b0 + (drift * (t - base)) / 3_600_000);
    const bRef = biasAt.reduce((s, x) => s + x, 0) / biasAt.length;
    const meas = times.map((t, k) => ({
      utcMs: t,
      h: truth[k].altitudeDeg + (noise ? gauss() * SIGMA_H : 0),
      A: truth[k].azimuthDeg + biasAt[k] + (noise ? gauss() * SIGMA_A : 0),
    }));
    const { best } = estimate(meas, null, prior);
    const pe = haversineKm(best.p[0], best.p[1], site.lat, site.lon);

    // مخلفات السمت بعد التقدير (بنموذج الانحياز الثابت)، وميلها الزمني بالدرجة/ساعة
    const tH = times.map((t) => (t - base) / 3_600_000);
    const rA = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, best.p[0], best.p[1]).azimuthDeg - best.p[2]));
    const tbar = tH.reduce((s, x) => s + x, 0) / tH.length;
    const rbar = rA.reduce((s, x) => s + x, 0) / rA.length;
    const Stt = tH.reduce((s, x) => s + (x - tbar) ** 2, 0);
    const slope = Stt > 0 ? tH.reduce((s, x, i) => s + (x - tbar) * (rA[i] - rbar), 0) / Stt : 0;
    const seSlope = Stt > 0 ? SIGMA_A / Math.sqrt(Stt) : Infinity; // خطأ ميل الضوضاء وحدها

    rows.push({
      absB: Math.abs(bRef),
      posKm: pe,
      bErr: Math.abs(best.p[2] - bRef),
      bErrSigned: best.p[2] - bRef,
      fail: !best.converged,
      bound: Math.abs(best.p[2]) >= B_MAX - 0.01,
      slope,
      z: seSlope > 0 ? Math.abs(slope) / seSlope : 0,
    });
  }
  return rows;
}

const out = [];
const priorSummary = {};
const driftSummary = {};
let seed = 11000;

// ---------- (1) prior sweep ----------
out.push("# (1) حساسية الـprior على b_A\n");
for (const site of CASES) {
  out.push(`## ${site.name}`);
  out.push("| σ_b للـprior | P95 موقع | وسيط موقع | P95 خطأ b | فشل LM | b عند ±20° | P95 موقع (|b|<2°) | P95 (2–5°) | P95 (5–10°) |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  priorSummary[site.name] = {};
  for (const pr of PRIORS) {
    const rows = trialSet(site, { prior: pr, drift: 0, noise: true, seed: seed++ });
    const pos = rows.map((r) => r.posKm);
    const cls = (lo, hi) => rows.filter((r) => r.absB >= lo && r.absB < hi).map((r) => r.posKm);
    const res = {
      p95: quant(pos, 0.95),
      med: quant(pos, 0.5),
      bP95: quant(rows.map((r) => r.bErr), 0.95),
      fail: rows.filter((r) => r.fail).length / rows.length,
      bound: rows.filter((r) => r.bound).length / rows.length,
      c1: quant(cls(0, 2), 0.95),
      c2: quant(cls(2, 5), 0.95),
      c3: quant(cls(5, 10.0001), 0.95),
    };
    priorSummary[site.name][String(pr)] = res;
    out.push(`| ${pr === null ? "بدون prior" : pr + "°"} | ${f(res.p95)} | ${f(res.med)} | ${f(res.bP95, 2)} | ${pct(res.fail)} | ${pct(res.bound)} | ${f(res.c1)} | ${f(res.c2)} | ${f(res.c3)} |`);
  }
  out.push("");
}

// ---------- (2) drift sweep + كاشف المخلفات ----------
out.push("# (2) الانحراف الزمني وكاشف المخلفات\n");
out.push("الكاشف: |ميل مخلفات السمت| / خطأ الميل من الضوضاء وحدها. عتبة 3 ⇒ «bias غير مستقر».\n");
for (const site of CASES) {
  out.push(`## ${site.name}`);
  out.push("| ḃ (°/س) | P95 موقع | P95 خطأ b (متوسط الانحياز) | فشل LM | كشف (z>3) | وسيط |z| |");
  out.push("|---|---|---|---|---|---|");
  driftSummary[site.name] = {};
  for (const d of DRIFTS) {
    const rows = trialSet(site, { prior: null, drift: d, noise: true, seed: seed++ });
    const res = {
      p95: quant(rows.map((r) => r.posKm), 0.95),
      bP95: quant(rows.map((r) => r.bErr), 0.95),
      fail: rows.filter((r) => r.fail).length / rows.length,
      detect: rows.filter((r) => r.z > 3).length / rows.length,
      zMed: quant(rows.map((r) => r.z), 0.5),
    };
    driftSummary[site.name][String(d)] = res;
    out.push(`| ${d} | ${f(res.p95)} | ${f(res.bP95, 2)} | ${pct(res.fail)} | ${pct(res.detect)} | ${f(res.zMed, 2)} |`);
  }
  out.push("");
}

console.log(out.join("\n"));
writeFileSync(new URL("./prior-drift-results.md", import.meta.url), out.join("\n") + "\n");
writeFileSync(new URL("./prior-drift-results.json", import.meta.url), JSON.stringify({ TRIALS, priorSummary, driftSummary }, null, 2));
