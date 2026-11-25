// gate-sim.mjs — محاكاة runtimeGate بمسارين متوازيين لكل تجربة:
//   A: استمرار Conditional Joint (تقدير مشترك لكل القياسات)
//   B: البوابة تراقب القياسات تسلسلياً، وعند الإنذار يُحوَّل إلى Position-only (b_A = 0)
// تُحفظ إشارات البوابة لكل مرحلة زمنية (k = 3..N) لتُختار العتبات لاحقاً من منحنى المقايضة.
// التشغيل: TRIALS=300 node gate-sim.mjs

import { writeFileSync } from "node:fs";
import { solarPosition } from "../engine/hisban-engine.js";
import { haversineKm } from "../core/hisban-core.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { estimate, residuals, inv3, SIGMA_A } from "./lm.mjs";

const TRIALS = Number(process.env.TRIALS ?? 300);
const KM_OK = 300; // لتوصيف الحالات "الخطرة" فقط في التقرير

const CONFIGS = [
  { name: "الجزائر N=4 Δ120", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360] },
  { name: "الجزائر N=5 Δ60", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 60, 120, 180, 240] },
  { name: "[قوي] الجزائر N=5 Δ120", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360, 480] },
];

// كل سيناريو: نوع الانحياز، ضوضاء البوصلة الفعلية، ودرجة الانحراف/القفزة/الشذوذ
const SCENARIOS = [
  { key: "base", label: "انحياز عشوائي ±10°", bias: { kind: "U", amp: 10 }, sA: 3 },
  { key: "b10", label: "انحياز ثابت ±10°", bias: { kind: "fix", amp: 10 }, sA: 3 },
  { key: "b15", label: "انحياز ثابت ±15°", bias: { kind: "fix", amp: 15 }, sA: 3 },
  { key: "b18", label: "انحياز قرب الحد ±18°", bias: { kind: "fix", amp: 18 }, sA: 3 },
  { key: "d1", label: "انحراف 1°/س", bias: { kind: "U", amp: 10 }, sA: 3, drift: 1 },
  { key: "d2", label: "انحراف 2°/س", bias: { kind: "U", amp: 10 }, sA: 3, drift: 2 },
  { key: "d3", label: "انحراف 3°/س", bias: { kind: "U", amp: 10 }, sA: 3, drift: 3 },
  { key: "d5", label: "انحراف 5°/س", bias: { kind: "U", amp: 10 }, sA: 3, drift: 5 },
  { key: "sA4", label: "ضوضاء σ_A=4°", bias: { kind: "U", amp: 10 }, sA: 4 },
  { key: "sA5", label: "ضوضاء σ_A=5°", bias: { kind: "U", amp: 10 }, sA: 5 },
  { key: "out", label: "شذوذ منفرد 15°", bias: { kind: "U", amp: 10 }, sA: 3, outlier: 15 },
  { key: "jump", label: "قفزة بوصلة +8° في المنتصف", bias: { kind: "U", amp: 10 }, sA: 3, jump: 8 },
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

// إشارات البوابة لمجموعة قياسات (بادئة)
function gateSignals(meas) {
  const k = meas.length;
  const { best } = estimate(meas, null);
  const r = residuals(best.p, meas);
  const chi = r.reduce((s, x) => s + x * x, 0);
  const dof = 2 * k - 3;
  const rms = dof > 0 ? Math.sqrt(chi / dof) : NaN;

  // ميل مخلفات السمت بالنسبة للزمن (درجة/ساعة) ومدى معنويته
  const t0 = meas[0].utcMs;
  const tH = meas.map((m) => (m.utcMs - t0) / 3_600_000);
  const rA = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, best.p[0], best.p[1]).azimuthDeg - best.p[2]));
  const tbar = tH.reduce((s, x) => s + x, 0) / k;
  const rbar = rA.reduce((s, x) => s + x, 0) / k;
  const Stt = tH.reduce((s, x) => s + (x - tbar) ** 2, 0);
  const slope = Stt > 0 ? tH.reduce((s, x, i) => s + (x - tbar) * (rA[i] - rbar), 0) / Stt : 0;
  const z = Stt > 0 ? Math.abs(slope) / (SIGMA_A / Math.sqrt(Stt)) : 0;

  const Hinv = inv3(best.H);
  const sigB = Hinv ? Math.sqrt(Math.max(0, Hinv[2][2])) : Infinity;
  return { z, bAbs: Math.abs(best.p[2]), rms, sigB };
}

function runTrial(cfg, sc, rng, gauss) {
  const base = cfg.day + 7 * 3_600_000;
  const times = cfg.off.map((m) => base + m * 60_000);
  const N = times.length;
  const truth = times.map((t) => solarPosition(t, cfg.lat, cfg.lon));

  // الانحياز الثابت الأساسي
  let b0;
  if (sc.bias.kind === "U") b0 = (rng() * 2 - 1) * sc.bias.amp;
  else b0 = (rng() < 0.5 ? -1 : 1) * sc.bias.amp;

  // شذوذ منفرد أو قفزة
  const outIdx = sc.outlier !== undefined ? Math.floor(rng() * N) : null;
  const outSign = rng() < 0.5 ? -1 : 1;
  const jumpIdx = sc.jump !== undefined ? Math.floor(N / 2) : null;
  const onset = outIdx !== null ? outIdx : jumpIdx;

  const meas = times.map((t, k) => {
    let bk = b0;
    if (sc.drift) bk += (sc.drift * (t - base)) / 3_600_000;
    let A = truth[k].azimuthDeg + bk + gauss() * sc.sA;
    if (outIdx === k) A += outSign * sc.outlier;
    if (jumpIdx !== null && k >= jumpIdx) A += sc.jump;
    return { utcMs: t, h: truth[k].altitudeDeg + gauss() * 1, A };
  });

  // مسار A: التقدير المشترك الكامل
  const full = estimate(meas, null).best;
  const EA = haversineKm(full.p[0], full.p[1], cfg.lat, cfg.lon);
  // مسار B (الوجهة عند الإنذار): Position-only بلا انحياز
  const pos = estimate(meas, 0).best;
  const EP = haversineKm(pos.p[0], pos.p[1], cfg.lat, cfg.lon);

  // إشارات البوابة لكل بادئة k = 3..N
  const signals = [];
  for (let k = 3; k <= N; k++) signals.push({ k, ...gateSignals(meas.slice(0, k)) });

  // الحقيقة الزمنية الفعلية للانحراف (للتوصيف)
  return { EA, EP, onset, signals, Nmeas: N };
}

const started = Date.now();
const records = [];
let seed = 20000;
for (const cfg of CONFIGS) {
  for (const sc of SCENARIOS) {
    const rng = mulberry32(seed++);
    const gauss = gaussFactory(rng);
    const recs = [];
    for (let i = 0; i < TRIALS; i++) recs.push(runTrial(cfg, sc, rng, gauss));
    records.push({ config: cfg.name, scenario: sc.key, label: sc.label, recs });
    console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${cfg.name} | ${sc.key}`);
  }
}
writeFileSync(new URL("./gate-records.json", import.meta.url), JSON.stringify({ TRIALS, records }));
console.log(`تم: ${records.length} سيناريو × ${TRIALS} تجربة`);
