// run.mjs — اختبار Monte Carlo لنظام المطابقة الفلكية.
// يولّد قياسات مزيّفة بأخطاء معروفة، ثم يقيس نجاح التحقق والخطأ بالكيلومتر ونسبة الغموض.
// التشغيل: TRIALS=1000 node run.mjs

import { writeFileSync } from "node:fs";
import { solarPosition, sunEvents } from "../engine/hisban-engine.js";
import { cellCenters, cellIndexOf } from "../grid/hisban-grid.js";
import { rankCells, refine, chiSquare } from "../matcher/hisban-matcher.js";
import { haversineKm } from "../core/hisban-core.js";

const chiLocal = (lat, lon, meas) => chiSquare(lat, lon, meas);

const TRIALS = Number(process.env.TRIALS ?? 1000);
const KM_PER_DEG = 111.32;
const CELLS = cellCenters(5);

const SITES = [
  { name: "الجزائر", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), baseH: 7 },
  { name: "كامبالا", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20), baseH: 7 },
  { name: "ترومسو", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21), baseH: 7 },
];

// ---------- مولّد أرقام عشوائية قابل للتكرار ----------
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

// ---------- السيناريوهات ----------
// sH, sA: الانحراف المعياري للضوضاء العشوائية (الارتفاع، السمت)
// biasA, biasH: انحياز ثابت غير معروف للنظام
// refrac: انكسار جوي غير مُنمذج (يُضاف للارتفاع القريب من الأفق)
const SCENARIOS = {
  S1_noise: { sH: 1, sA: 3, biasA: 0, biasH: 0, refrac: 0, anchor: "noon" },
  S2_bias_plus5: { sH: 0, sA: 0, biasA: 5, biasH: 0, refrac: 0, anchor: "noon" },
  S2_bias_minus8: { sH: 0, sA: 0, biasA: -8, biasH: 0, refrac: 0, anchor: "noon" },
  S3_noise_bias5: { sH: 1, sA: 3, biasA: 5, biasH: 0, refrac: 0, anchor: "noon" },
  S4_horizon: { sH: 2, sA: 3, biasA: 0, biasH: 0, refrac: 0.6, anchor: "sunrise" },
};

// ---------- تشغيل تجربة واحدة لموقع وإعداد ----------
function buildTruthTimes(site, offsetsMin, anchor) {
  let base;
  if (anchor === "sunrise") {
    const sr = sunEvents(site.day, site.lat, site.lon).sunriseUtc;
    if (sr == null) return null; // لا شروق في هذا الموقع/التاريخ
    base = sr;
  } else {
    base = site.day + site.baseH * 3_600_000;
  }
  return offsetsMin.map((m) => base + m * 60_000);
}

function runConfig({ site, scenario, offsetsMin, keep, seed }) {
  const times = buildTruthTimes(site, offsetsMin, scenario.anchor);
  if (!times) return null;
  const truth = times.map((t) => solarPosition(t, site.lat, site.lon));
  const truthCell = cellIndexOf(site.lat, site.lon, 5);
  const rng = mulberry32(seed);
  const gauss = gaussFactory(rng);

  const agg = {
    top1: 0, top5: 0, top10: 0,
    errs: [], lostAny: 0, Rs: [], closeCounts: [],
  };

  for (let trial = 0; trial < TRIALS; trial++) {
    // القياسات المرصودة مع الأخطاء
    const meas = times.map((t, k) => ({
      utcMs: t,
      altitudeDeg: truth[k].altitudeDeg + scenario.biasH + scenario.refrac + gauss() * scenario.sH,
      azimuthDeg: truth[k].azimuthDeg + scenario.biasA + gauss() * scenario.sA,
      sigmaAlt: 1, // النظام يفترض دقة الارتفاع 1°
      sigmaAz: 3,  // ويفترض دقة السمت 3°
    }));

    // مرحلة 1: الترتيب الخشن على شبكة 5° كاملة
    const all = rankCells(CELLS, meas, CELLS.length);
    const coarse = all.slice(0, 10);
    const coarseIdx = coarse.map((c) => cellIndexOf(c.lat, c.lon, 5));
    if (coarseIdx.slice(0, 1).includes(truthCell)) agg.top1++;
    if (coarseIdx.slice(0, 5).includes(truthCell)) agg.top5++;
    if (coarseIdx.includes(truthCell)) agg.top10++;

    // الغموض العالمي: أفضل بديل يبعد أكثر من 500 كم عن أفضل خلية
    const gBest = all[0];
    const gAlt = all.find((c) => haversineKm(c.lat, c.lon, gBest.lat, gBest.lon) > 500);
    agg.Rs.push(gAlt ? Math.exp((gAlt.chi2 - gBest.chi2) / 2) : Infinity);
    agg.closeCounts.push(
      all.filter((c) => c.chi2 <= gBest.chi2 + 2 && haversineKm(c.lat, c.lon, gBest.lat, gBest.lon) > 500).length
    );

    // مرحلة 2: التحسين الهرمي
    const final = refine(meas, coarse, { startStep: 5, minStep: 0.05, keep });
    const best = final[0];
    agg.errs.push(haversineKm(best.lat, best.lon, site.lat, site.lon));

    // فشل التحسين الحقيقي: الناتج أسوأ من أفضل نقطة قرب الحقيقة (±2°، شبكة 0.25°)
    let localMin = Infinity;
    for (let di = -2; di <= 2; di += 0.25) {
      for (let dj = -2; dj <= 2; dj += 0.25) {
        const lat = Math.min(90, Math.max(-90, site.lat + di));
        const lon = site.lon + dj;
        const c2 = chiLocal(lat, lon, meas);
        if (c2 < localMin) localMin = c2;
      }
    }
    if (best.chi2 > localMin + 0.5) agg.lostAny++;
  }

  const sorted = [...agg.errs].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const finiteR = agg.Rs.filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
  const medR = finiteR.length ? finiteR[Math.floor(finiteR.length / 2)] : Infinity;
  const ambiguous = agg.Rs.filter((r) => r < 2).length / TRIALS;
  const closeSorted = [...agg.closeCounts].sort((a, b) => a - b);

  return {
    site: site.name,
    scenario: scenario.name,
    N: times.length,
    spacingMin: offsetsMin.length > 1 ? offsetsMin[1] - offsetsMin[0] : 0,
    keep,
    top1: agg.top1 / TRIALS,
    top5: agg.top5 / TRIALS,
    top10: agg.top10 / TRIALS,
    medianKm: q(0.5),
    meanKm: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p90Km: q(0.9),
    p95Km: q(0.95),
    lostRate: agg.lostAny / TRIALS,
    medianR: medR,
    ambiguousRate: ambiguous,
    medianCloseCount: closeSorted[Math.floor(closeSorted.length / 2)],
  };
}

// ---------- قائمة التجارب ----------
const configs = [];
let seedBase = 1000;
const add = (siteIdx, scenarioName, offsetsMin, keep) => {
  configs.push({
    site: SITES[siteIdx],
    scenario: { name: scenarioName, ...SCENARIOS[scenarioName] },
    offsetsMin,
    keep,
    seed: seedBase++,
  });
};

// (أ) الجدول الرئيسي: قياسان بفاصل 60 دقيقة، keep=20
for (let s = 0; s < SITES.length; s++) {
  for (const sc of Object.keys(SCENARIOS)) add(s, sc, [0, 60], 20);
}
// (ب) عدد القياسات N = 1, 3, 4 (ضوضاء فقط، فاصل 60 دقيقة)
for (let s = 0; s < SITES.length; s++) {
  add(s, "S1_noise", [0], 20);
  add(s, "S1_noise", [0, 60, 120], 20);
  add(s, "S1_noise", [0, 60, 120, 180], 20);
}
// (ج) الفاصل الزمني بين قياسين: 10 و30 و120 دقيقة
for (let s = 0; s < SITES.length; s++) {
  add(s, "S1_noise", [0, 10], 20);
  add(s, "S1_noise", [0, 30], 20);
  add(s, "S1_noise", [0, 120], 20);
}
// (د) حساسية keep: 10 و50 و100 على الضوضاء والضوضاء+انحياز
for (let s = 0; s < SITES.length; s++) {
  for (const k of [10, 50, 100]) {
    add(s, "S1_noise", [0, 60], k);
    add(s, "S3_noise_bias5", [0, 60], k);
  }
}

const results = [];
const started = Date.now();
for (const cfg of configs) {
  const r = runConfig(cfg);
  if (r) results.push(r);
  const dt = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`[${dt}s] ${cfg.site.name} | ${cfg.scenario.name} | N=${cfg.offsetsMin.length} | Δ=${cfg.offsetsMin.length > 1 ? cfg.offsetsMin[1] : 0} | keep=${cfg.keep} | done`);
}

writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ TRIALS, results }, null, 2));

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "∞");
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const lines = [
  `# نتائج Monte Carlo (TRIALS = ${TRIALS})`,
  "",
  "| الموقع | السيناريو | N | الفاصل (دقيقة) | keep | Top-1 | Top-5 | Top-10 | الوسيط (كم) | المتوسط (كم) | P90 (كم) | P95 (كم) | فشل التحسين | الوسيط R | غموض عالمي (R<2) | بدائل بعيدة >500 كم (Δχ²≤2، وسيط) |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...results.map((r) =>
    `| ${r.site} | ${r.scenario} | ${r.N} | ${r.spacingMin} | ${r.keep} | ${pct(r.top1)} | ${pct(r.top5)} | ${pct(r.top10)} | ${f(r.medianKm, 0)} | ${f(r.meanKm, 0)} | ${f(r.p90Km, 0)} | ${f(r.p95Km, 0)} | ${pct(r.lostRate)} | ${f(r.medianR, 2)} | ${pct(r.ambiguousRate)} | ${r.medianCloseCount} |`
  ),
];
writeFileSync(new URL("./results.md", import.meta.url), lines.join("\n") + "\n");
console.log("تم: results.json و results.md");
