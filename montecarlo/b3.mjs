// b3.mjs — المرحلة B3: Monte Carlo للمعايرة المشتركة مقابل البدائل.
// السيناريوهات لكل إعداد:
//   known      : b_A معلوم (مثبّت على القيمة الحقيقية) مع ضوضاء  ← أفضل أداء ممكن
//   joint      : b_A مجهول ويُقدَّر مع (φ, λ) مع ضوضاء         ← المعايرة المشتركة
//   nocal      : b_A مفترض صفراً بينما الحقيقة غير صفرية       ← بدون معايرة
//   joint0     : b_A مجهول بلا ضوضاء                           ← أثر المحسّن وحده
//   drift(ḃ)   : انحياز يتغير خطياً، والنموذج يفترض ثابتاً      ← مع ضوضاء
// التشغيل: TRIALS=500 node b3.mjs

import { writeFileSync } from "node:fs";
import { solarPosition } from "../engine/hisban-engine.js";
import { haversineKm } from "../core/hisban-core.js";
import { estimate, SIGMA_H, SIGMA_A, B_MAX, LOCAL, inv3 } from "./lm.mjs";

const TRIALS = Number(process.env.TRIALS ?? 500);
const B_RANGE = 10; // b_A ~ U(−10°, 10°)
const KM = 111.32;

const CASES = [
  { name: "الجزائر N=4 Δ120", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360], control: false },
  { name: "الجزائر N=5 Δ60", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 60, 120, 180, 240], control: false },
  { name: "كامبالا N=3 Δ120", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20), off: [0, 120, 240], control: false },
  { name: "[ضابط] ترومسو N=2 Δ60", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21), off: [0, 60], control: true },
];

const SCENARIOS = [
  { key: "known", label: "bias معلوم", fit: false, noise: true, bMode: "true" },
  { key: "joint", label: "bias مجهول + ضوضاء (معايرة مشتركة)", fit: true, noise: true, bMode: "uniform" },
  { key: "nocal", label: "بدون معايرة (b=0)", fit: false, noise: true, bMode: "zero" },
  { key: "joint0", label: "bias مجهول بلا ضوضاء", fit: true, noise: false, bMode: "uniform" },
  { key: "drift+0.2", label: "انحراف ḃ=+0.2°/س", fit: true, noise: true, bMode: "drift", rate: 0.2 },
  { key: "drift+0.5", label: "انحراف ḃ=+0.5°/س", fit: true, noise: true, bMode: "drift", rate: 0.5 },
  { key: "drift+1", label: "انحراف ḃ=+1°/س", fit: true, noise: true, bMode: "drift", rate: 1 },
  { key: "drift-1", label: "انحراف ḃ=−1°/س", fit: true, noise: true, bMode: "drift", rate: -1 },
];

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
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const median = (arr) => quant(arr, 0.5);

function runScenario(site, sc, seed) {
  const base = site.day + 7 * 3_600_000;
  const times = site.off.map((m) => base + m * 60_000);
  const truthPos = times.map((t) => solarPosition(t, site.lat, site.lon));
  const rng = mulberry32(seed);
  const gauss = gaussFactory(rng);
  const res = { posKm: [], bErr: [], bErrSigned: [], chi2: [], sigmaBH: [], fail: 0, bound: 0, localBound: 0, multi: 0 };

  for (let trial = 0; trial < TRIALS; trial++) {
    const b0 = (rng() * 2 - 1) * B_RANGE;
    const biasAt = times.map((t) => {
      if (sc.bMode === "true" || sc.bMode === "uniform") return b0;
      if (sc.bMode === "zero") return b0;
      if (sc.bMode === "drift") return b0 + (sc.rate * (t - base)) / 3_600_000;
      return 0;
    });
    const bRef = biasAt.reduce((s, x) => s + x, 0) / biasAt.length;

    const meas = times.map((t, k) => ({
      utcMs: t,
      h: truthPos[k].altitudeDeg + (sc.noise ? gauss() * SIGMA_H : 0),
      A: truthPos[k].azimuthDeg + biasAt[k] + (sc.noise ? gauss() * SIGMA_A : 0),
    }));

    const fixB = sc.bMode === "zero" ? 0 : sc.bMode === "true" ? bRef : null;
    const { best, runs } = estimate(meas, fixB);
    const pe = haversineKm(best.p[0], best.p[1], site.lat, site.lon);
    res.posKm.push(pe);
    res.chi2.push(best.chi2);
    if (!best.converged) res.fail++;
    if (sc.fit) {
      const bErrS = best.p[2] - bRef;
      res.bErr.push(Math.abs(bErrS));
      res.bErrSigned.push(bErrS);
      if (Math.abs(best.p[2]) >= B_MAX - 0.01) res.bound++;
      // Fisher محلي عند الحل: σ_b = √((H⁻¹)₃₃)
      const Hinv = inv3(best.H);
      if (Hinv && Hinv[2][2] > 0) res.sigmaBH.push(Math.sqrt(Hinv[2][2]));
    }
    if (Math.abs(best.p[0] - best.start.lat) >= LOCAL - 0.01 || Math.abs(best.p[1] - best.start.lon) >= LOCAL - 0.01) res.localBound++;
    // بديل حقيقي فقط: متقارب، وχ² قريب من أفضل حل، وبعيد أكثر من 50 كم
    const other = runs.slice(1).some((r) => r.converged && r.chi2 <= best.chi2 + 1 && haversineKm(r.p[0], r.p[1], best.p[0], best.p[1]) > 50);
    if (other) res.multi++;
  }

  const n = TRIALS;
  const bias = sc.fit
    ? {
        bMed: median(res.bErr),
        bP95: quant(res.bErr, 0.95),
        sigmaEmp: Math.sqrt(res.bErrSigned.reduce((s, x) => s + x * x, 0) / res.bErrSigned.length - (res.bErrSigned.reduce((s, x) => s + x, 0) / res.bErrSigned.length) ** 2),
        sigmaFisher: median(res.sigmaBH),
        boundRate: res.bound / n,
      }
    : null;
  return {
    med: median(res.posKm),
    p90: quant(res.posKm, 0.9),
    p95: quant(res.posKm, 0.95),
    lt100: res.posKm.filter((x) => x < 100).length / n,
    lt300: res.posKm.filter((x) => x < 300).length / n,
    failRate: res.fail / n,
    localBoundRate: res.localBound / n,
    multiRate: res.multi / n,
    chiMed: median(res.chi2),
    chiMean: res.chi2.reduce((s, x) => s + x, 0) / n,
    bias,
  };
}

const out = [];
const summary = [];
let seed = 9000;
const started = Date.now();
for (const site of CASES) {
  out.push(`\n## ${site.name}`);
  out.push("| السيناريو | وسيط الموقع (كم) | P90 | P95 | <100 كم | <300 كم | فشل LM | حد الموقع | وسيط خطأ b | P95 خطأ b | حد b | σ_b تجريبي | σ_b Fisher(H) | حلول متعددة | χ² وسيط |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const rowsForSite = {};
  for (const sc of SCENARIOS) {
    const r = runScenario(site, sc, seed++);
    rowsForSite[sc.key] = r;
    const b = r.bias;
    out.push(
      `| ${sc.label} | ${f(r.med)} | ${f(r.p90)} | ${f(r.p95)} | ${pct(r.lt100)} | ${pct(r.lt300)} | ${pct(r.failRate)} | ${pct(r.localBoundRate)} | ${b ? f(b.bMed, 2) : "—"} | ${b ? f(b.bP95, 2) : "—"} | ${b ? pct(b.boundRate) : "—"} | ${b ? f(b.sigmaEmp, 2) : "—"} | ${b ? f(b.sigmaFisher, 2) : "—"} | ${pct(r.multiRate)} | ${f(r.chiMed, 2)} |`
    );
  }
  summary.push({ site: site.name, rows: rowsForSite });
  out.push(`(انتهى ${site.name} عند ${((Date.now() - started) / 1000).toFixed(0)} ث)`);
}

// الجدول النهائي: No calibration / Known / Joint / Drift
out.push("\n# الجدول النهائي: P95 للموقع (كم)");
out.push("| الموقع | بدون معايرة | معلوم | مشترك | مشترك بلا ضوضاء | انحراف 0.5°/س | ثمن عدم المعرفة (مشترك − معلوم) | ثمن الإهمال (بدون − مشترك) |");
out.push("|---|---|---|---|---|---|---|---|");
for (const s of summary) {
  const R = s.rows;
  out.push(`| ${s.site} | ${f(R.nocal.p95)} | ${f(R.known.p95)} | ${f(R.joint.p95)} | ${f(R.joint0.p95)} | ${f(R["drift+0.5"].p95)} | ${f(R.joint.p95 - R.known.p95)} | ${f(R.nocal.p95 - R.joint.p95)} |`);
}

console.log(out.join("\n"));
writeFileSync(new URL("./b3-results.md", import.meta.url), out.join("\n") + "\n");
