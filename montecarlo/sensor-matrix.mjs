// sensor-matrix.mjs — مصفوفة حساسية: دقة البوصلة σ_A × الانحياز b_A × عدد القياسات × الفاصل الزمني.
// لكل خانة: Monte Carlo للمطابقة + توقع Fisher (حد نظري تقريبي للدقة) + غموض عالمي.
// التشغيل: TRIALS=300 node sensor-matrix.mjs

import { writeFileSync } from "node:fs";
import { solarPosition, sunEvents } from "../engine/hisban-engine.js";
import { cellCenters, cellIndexOf } from "../grid/hisban-grid.js";
import { rankCells, refine, prepare, chi2Prepared, wrapDeg } from "../matcher/hisban-matcher.js";
import { haversineKm } from "../core/hisban-core.js";

const TRIALS = Number(process.env.TRIALS ?? 300);
const KM = 111.32;
const CELLS = cellCenters(5);
const SIGMA_H = 1;
const SIGMA_A_LIST = [0.5, 1, 2, 3, 4, 5];
const BIAS_LIST = [0, 1, 3, 5, 10];
const TIME_CONFIGS = [
  { N: 1, spacing: 0 },
  { N: 2, spacing: 30 }, { N: 2, spacing: 60 }, { N: 2, spacing: 120 },
  { N: 3, spacing: 30 }, { N: 3, spacing: 60 }, { N: 3, spacing: 120 },
  { N: 4, spacing: 30 }, { N: 4, spacing: 60 }, { N: 4, spacing: 120 },
];
const SITES = [
  { name: "الجزائر", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10) },
  { name: "كامبالا", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20) },
  { name: "ترومسو", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21) },
];
const BASE_H = 7;

// ---------- مولّد عشوائي قابل للتكرار ----------
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

// ---------- مصفوفة Fisher وتوقع الدقة ----------
// J: مشتقات (h, A) بالنسبة إلى (φ, λ) بالدرجات، وF = Σ JᵀΣ⁻¹J، والدقة = √(F⁻¹) بالكيلومتر.
function fisherPrediction(site, times, sigmaA) {
  const e = 0.01;
  let F = [[0, 0], [0, 0]];
  for (const t of times) {
    const hp = solarPosition(t, site.lat + e, site.lon);
    const hm = solarPosition(t, site.lat - e, site.lon);
    const lp = solarPosition(t, site.lat, site.lon + e);
    const lm = solarPosition(t, site.lat, site.lon - e);
    const dhdphi = (hp.altitudeDeg - hm.altitudeDeg) / (2 * e);
    const dhdlam = (lp.altitudeDeg - lm.altitudeDeg) / (2 * e);
    const dAdphi = wrapDeg(hp.azimuthDeg - hm.azimuthDeg) / (2 * e);
    const dAdlam = wrapDeg(lp.azimuthDeg - lm.azimuthDeg) / (2 * e);
    const wh = 1 / (SIGMA_H * SIGMA_H), wa = 1 / (sigmaA * sigmaA);
    // مساهمة h
    F[0][0] += wh * dhdphi * dhdphi; F[0][1] += wh * dhdphi * dhdlam; F[1][1] += wh * dhdlam * dhdlam;
    // مساهمة A
    F[0][0] += wa * dAdphi * dAdphi; F[0][1] += wa * dAdphi * dAdlam; F[1][1] += wa * dAdlam * dAdlam;
  }
  F[1][0] = F[0][1];
  const det = F[0][0] * F[1][1] - F[0][1] * F[1][0];
  if (!(det > 1e-12)) return { sigmaRadialKm: Infinity, sigmaWorstKm: Infinity };
  // C = F⁻¹ بالدرجات²
  const C = [[F[1][1] / det, -F[0][1] / det], [-F[1][0] / det, F[0][0] / det]];
  // تحويل إلى كيلومترات: الصف الأول × KM، الثاني × KM·cosφ
  const cosφ = Math.cos((site.lat * Math.PI) / 180);
  const S = [KM, KM * Math.max(cosφ, 1e-6)];
  const Ck = [
    [C[0][0] * S[0] * S[0], C[0][1] * S[0] * S[1]],
    [C[1][0] * S[1] * S[0], C[1][1] * S[1] * S[1]],
  ];
  const tr = Ck[0][0] + Ck[1][1];
  const disc = Math.sqrt(Math.max(0, ((Ck[0][0] - Ck[1][1]) / 2) ** 2 + Ck[0][1] * Ck[0][1]));
  const lamMax = tr / 2 + disc;
  return { sigmaRadialKm: Math.sqrt(tr), sigmaWorstKm: Math.sqrt(lamMax) };
}

// ---------- تجربة Monte Carlo لخانة واحدة ----------
function runCell(site, times, sigmaA, biasA, seed) {
  const truth = times.map((t) => solarPosition(t, site.lat, site.lon));
  const truthCell = cellIndexOf(site.lat, site.lon, 5);
  const rng = mulberry32(seed);
  const gauss = gaussFactory(rng);

  let top10 = 0;
  const errs = [];
  let ambiguous = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    const meas = times.map((t, k) => ({
      utcMs: t,
      altitudeDeg: truth[k].altitudeDeg + gauss() * SIGMA_H,
      azimuthDeg: truth[k].azimuthDeg + biasA + gauss() * sigmaA,
      sigmaAlt: 1,
      sigmaAz: 3, // النظام يفترض σ_A = 3° دائماً، ولا يعرف الانحياز
    }));
    const all = rankCells(CELLS, meas, CELLS.length);
    const coarse = all.slice(0, 10);
    if (coarse.some((c) => cellIndexOf(c.lat, c.lon, 5) === truthCell)) top10++;
    const gBest = all[0];
    const gAlt = all.find((c) => haversineKm(c.lat, c.lon, gBest.lat, gBest.lon) > 500);
    const R = gAlt ? Math.exp((gAlt.chi2 - gBest.chi2) / 2) : Infinity;
    if (R < 2) ambiguous++;
    const final = refine(meas, coarse, { startStep: 5, minStep: 0.05, keep: 10 });
    errs.push(haversineKm(final[0].lat, final[0].lon, site.lat, site.lon));
  }
  errs.sort((a, b) => a - b);
  const q = (p) => errs[Math.min(errs.length - 1, Math.floor(p * errs.length))];
  return {
    top10: top10 / TRIALS,
    medianKm: q(0.5),
    p95Km: q(0.95),
    ambiguousRate: ambiguous / TRIALS,
  };
}

// ---------- الحلقة الرئيسية ----------
const rows = [];
let seed = 7000;
const started = Date.now();
for (const site of SITES) {
  const base = site.day + BASE_H * 3_600_000;
  for (const tc of TIME_CONFIGS) {
    const offsets = Array.from({ length: tc.N }, (_, k) => k * tc.spacing);
    const times = offsets.map((m) => base + m * 60_000);
    for (const sigmaA of SIGMA_A_LIST) {
      const fisher = fisherPrediction(site, times, sigmaA);
      for (const biasA of BIAS_LIST) {
        const r = runCell(site, times, sigmaA, biasA, seed++);
        rows.push({
          site: site.name,
          N: tc.N,
          spacingMin: tc.spacing,
          sigmaA,
          biasA,
          top10: r.top10,
          medianKm: r.medianKm,
          p95Km: r.p95Km,
          ambiguousRate: r.ambiguousRate,
          fisherRadialKm: fisher.sigmaRadialKm,
          fisherWorstKm: fisher.sigmaWorstKm,
        });
      }
    }
    const dt = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`[${dt}s] ${site.name} | N=${tc.N} | Δ=${tc.spacing}`);
  }
}

// CSV كامل
const header = "site,N,spacing_min,sigma_A,bias_A,top10,median_km,p95_km,ambiguous_rate,fisher_radial_km,fisher_worst_km";
const csv = [header, ...rows.map((r) =>
  [r.site, r.N, r.spacingMin, r.sigmaA, r.biasA, r.top10.toFixed(4), r.medianKm.toFixed(1), r.p95Km.toFixed(1),
   r.ambiguousRate.toFixed(4), Number.isFinite(r.fisherRadialKm) ? r.fisherRadialKm.toFixed(1) : "inf",
   Number.isFinite(r.fisherWorstKm) ? r.fisherWorstKm.toFixed(1) : "inf"].join(","))].join("\n");
writeFileSync(new URL("./sensor-matrix.csv", import.meta.url), csv + "\n");
writeFileSync(new URL("./sensor-matrix.json", import.meta.url), JSON.stringify({ TRIALS, rows }, null, 2));
console.log(`تم: ${rows.length} خانة، TRIALS=${TRIALS}`);
