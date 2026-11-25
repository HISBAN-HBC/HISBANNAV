// features6.mjs — ميزات الشذوذ: O_i و t_i و D₋ᵢ لكل قياس، لكل تجربة.
import { writeFileSync } from "node:fs";
import { solarPosition } from "../engine/hisban-engine.js";
import { SIGMA_A } from "./lm.mjs";
import { fitM0, Dstat } from "./models.mjs";
import { outlierStats } from "./models3.mjs";

const N = Number(process.env.N ?? 5);
const TRIALS = Number(process.env.TRIALS ?? 300);
const lat = 36.75, lon = 3.04, day = Date.UTC(2026, 10, 10);
const off = Array.from({ length: N }, (_, i) => (i * 480) / (N - 1));
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gaussOf = (rng) => () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const SCEN = [
  { key: "stable", sc: {} },
  { key: "stable_sA5", sc: { sA: 5 } },
  { key: "drift1", sc: { drift: 1 } },
  { key: "drift2", sc: { drift: 2 } },
  { key: "drift3", sc: { drift: 3 } },
  { key: "drift5", sc: { drift: 5 } },
  { key: "outlier10", sc: { outlier: 10 } },
  { key: "outlier15", sc: { outlier: 15 } },
  { key: "outlier20", sc: { outlier: 20 } },
  { key: "jump8_mid", sc: { jump: 8, jc: Math.floor(N / 2) } },
  { key: "jump12_mid", sc: { jump: 12, jc: Math.floor(N / 2) } },
];

function trial(sc, rng, gauss) {
  const base = day + 7 * 3_600_000;
  const times = off.map((m) => base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, lat, lon));
  const b0 = (rng() * 2 - 1) * 10;
  const oi = sc.outlier ? Math.floor(rng() * N) : -1;
  const os = rng() < 0.5 ? -1 : 1;
  const meas = times.map((t, k) => {
    let A = truth[k].azimuthDeg + b0 + (sc.drift ? (sc.drift * (t - base)) / 3_600_000 : 0) + gauss() * (sc.sA ?? SIGMA_A);
    if (k === oi) A += os * sc.outlier;
    if (sc.jump && k >= sc.jc) A += sc.jump;
    return { utcMs: t, h: truth[k].altitudeDeg + gauss(), A };
  });
  const best = fitM0(meas);
  return { D: Dstat(meas, best.p), ps: outlierStats(meas, best), oi };
}

const out = [];
const t0 = Date.now();
let seed = 600000 + N;
for (const s of SCEN) {
  const rng = mulberry32(seed++); const gauss = gaussOf(rng);
  const recs = [];
  for (let i = 0; i < TRIALS; i++) recs.push(trial(s.sc, rng, gauss));
  out.push({ key: s.key, recs });
}
writeFileSync(new URL(`./f6-N${N}.json`, import.meta.url), JSON.stringify({ N, out }));
console.log(`N=${N}: ${out.length} سيناريو في ${((Date.now() - t0) / 1000).toFixed(0)}s`);
