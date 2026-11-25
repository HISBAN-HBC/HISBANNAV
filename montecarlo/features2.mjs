// features2.mjs — محاكاة M0/M1/M2 مع سيناريوهات قفزة متعددة، وتسجيل ĉ.
import { writeFileSync } from "node:fs";
import { solarPosition } from "../engine/hisban-engine.js";
import { SIGMA_A } from "./lm.mjs";
import { fitM0, Dstat, dropOne, meanTimeMs } from "./models.mjs";
import { fitM1, fitM2 } from "./models2.mjs";

const TRIALS = Number(process.env.TRIALS ?? 300);
const cfg = { lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360, 480] };
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gaussOf = (rng) => () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// truthC: أول عينة بعد القفزة (فهرس)، null إذا لا قفزة
const SCEN = [
  { key: "stable", truth: "STABLE", sc: {} },
  { key: "stable_sA5", truth: "STABLE", sc: { sA: 5 } },
  { key: "drift1", truth: "DRIFT", sc: { drift: 1 } },
  { key: "drift2", truth: "DRIFT", sc: { drift: 2 } },
  { key: "drift3", truth: "DRIFT", sc: { drift: 3 } },
  { key: "drift5", truth: "DRIFT", sc: { drift: 5 } },
  { key: "outlier15", truth: "OUTLIER", sc: { outlier: 15 } },
  { key: "jump4_mid", truth: "JUMP", sc: { jump: 4, jc: 2 } },
  { key: "jump8_mid", truth: "JUMP", sc: { jump: 8, jc: 2 } },
  { key: "jump12_mid", truth: "JUMP", sc: { jump: 12, jc: 2 } },
  { key: "jump8_early", truth: "JUMP", sc: { jump: 8, jc: 1 } },
  { key: "jump8_late", truth: "JUMP", sc: { jump: 8, jc: 3 } },
  { key: "jump12_late", truth: "JUMP", sc: { jump: 12, jc: 3 } },
];

function trial(sc, rng, gauss) {
  const base = cfg.day + 7 * 3_600_000;
  const times = cfg.off.map((m) => base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, cfg.lat, cfg.lon));
  const N = times.length;
  const b0 = (rng() * 2 - 1) * 10;
  const outIdx = sc.outlier ? Math.floor(rng() * N) : -1;
  const outSign = rng() < 0.5 ? -1 : 1;
  const meas = times.map((t, k) => {
    let A = truth[k].azimuthDeg + b0 + (sc.drift ? (sc.drift * (t - base)) / 3_600_000 : 0) + gauss() * (sc.sA ?? SIGMA_A);
    if (k === outIdx) A += outSign * sc.outlier;
    if (sc.jump && k >= sc.jc) A += sc.jump;
    return { utcMs: t, h: truth[k].altitudeDeg + gauss(), A };
  });
  const m0 = fitM0(meas);
  const D = Dstat(meas, m0.p);
  const { Omax, Dminus } = dropOne(meas, m0);
  const t0 = meanTimeMs(meas);
  const m1 = fitM1(meas, m0.p, t0);
  const m2 = fitM2(meas, m0.p);
  return {
    D, Omax, Dminus, sigB0: m0.H ? Math.sqrt(Math.max(0, invDiag(m0.H))) : Infinity,
    chi0: m0.chi2, chi1: m1.chi2, chi2: m2.chi2, N,
    bd: m1.p[3], sigBd: m1.sigBd, zb: Math.abs(m1.p[3]) / m1.sigBd,
    cHat: m2.c, b1: m2.p[2], b2: m2.p[3],
    cTrue: sc.jump ? sc.jc : null,
  };
}
// (H^{-1})_{bb} لـM0: نستخدم الدالة المحفوظة في lm.mjs عبر inv3 داخل fitM0
import { inv3 } from "./lm.mjs";
function invDiag(H) { const I = inv3(H); return I ? I[2][2] : Infinity; }

const out = [];
const t0s = Date.now();
let seed = 130000;
for (const s of SCEN) {
  const rng = mulberry32(seed++); const gauss = gaussOf(rng);
  const recs = [];
  for (let i = 0; i < TRIALS; i++) recs.push(trial(s.sc, rng, gauss));
  out.push({ key: s.key, truth: s.truth, recs });
  console.log(`[${((Date.now() - t0s) / 1000).toFixed(0)}s] ${s.key}`);
}
writeFileSync(new URL("./features2.json", import.meta.url), JSON.stringify({ TRIALS, out }));
console.log(`تم: ${out.length} سيناريو × ${TRIALS}`);
