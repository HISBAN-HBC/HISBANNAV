// features3.mjs — تصميم N (عدد القياسات) مع فصل الطريقتين:
//   DESIGN=A : نافذة ثابتة 8h، N متغير (فاصل = 480/(N−1) دقيقة)
//   DESIGN=B : فاصل ثابت 60 دقيقة، نافذة = (N−1) ساعة
// يسجل Δ_J = χ²_M1 − min_c χ²_M2(c) ويتضمن سيناريوهات قفزة بكل موقع c.
import { writeFileSync } from "node:fs";
import { solarPosition } from "../engine/hisban-engine.js";
import { SIGMA_A, inv3 } from "./lm.mjs";
import { fitM0, Dstat, dropOne, meanTimeMs } from "./models.mjs";
import { fitM1, fitM2 } from "./models2.mjs";

const DESIGN = process.env.DESIGN ?? "A";
const N = Number(process.env.N ?? 5);
const TRIALS = Number(process.env.TRIALS ?? 200);
const SWEEP = Number(process.env.SWEEP ?? 100);
const lat = 36.75, lon = 3.04, day = Date.UTC(2026, 10, 10);
const off = DESIGN === "A"
  ? Array.from({ length: N }, (_, i) => (i * 480) / (N - 1))
  : Array.from({ length: N }, (_, i) => i * 60);
const mid = Math.floor(N / 2);

const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gaussOf = (rng) => () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const core = [
  { key: "stable", truth: "STABLE", sc: {} },
  { key: "stable_sA5", truth: "STABLE", sc: { sA: 5 } },
  { key: "drift1", truth: "DRIFT", sc: { drift: 1 } },
  { key: "drift2", truth: "DRIFT", sc: { drift: 2 } },
  { key: "drift3", truth: "DRIFT", sc: { drift: 3 } },
  { key: "drift5", truth: "DRIFT", sc: { drift: 5 } },
  { key: "outlier15", truth: "OUTLIER", sc: { outlier: 15 } },
  { key: "jump4_mid", truth: "JUMP", sc: { jump: 4, jc: mid } },
  { key: "jump8_mid", truth: "JUMP", sc: { jump: 8, jc: mid } },
  { key: "jump12_mid", truth: "JUMP", sc: { jump: 12, jc: mid } },
];
const sweep = [];
for (let c = 1; c <= N - 1; c++) for (const j of [8, 12]) sweep.push({ key: `jump${j}_c${c}`, truth: "JUMP", sc: { jump: j, jc: c }, n: SWEEP });

function trial(sc, rng, gauss) {
  const base = day + 7 * 3_600_000;
  const times = off.map((m) => base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, lat, lon));
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
  const m2 = fitM2(meas, m0.p); // N≥4 لأن c∈{2..N−2}
  const I = inv3(m0.H);
  return {
    D, Omax, Dminus, sigB0: I ? Math.sqrt(Math.max(0, I[2][2])) : Infinity,
    chi0: m0.chi2, chi1: m1.chi2, chi2: m2.chi2, cHat: m2.c,
    dJ: m1.chi2 - m2.chi2, dJ0: m0.chi2 - m2.chi2,
    cTrue: sc.jump ? sc.jc : null, N,
  };
}

const out = [];
const t0s = Date.now();
let seed = 500000 + N * 100 + (DESIGN === "A" ? 0 : 7);
for (const s of [...core, ...sweep]) {
  const rng = mulberry32(seed++); const gauss = gaussOf(rng);
  const n = s.n ?? TRIALS;
  const recs = [];
  for (let i = 0; i < n; i++) recs.push(trial(s.sc, rng, gauss));
  out.push({ key: s.key, truth: s.truth, sweep: !!s.n, recs });
}
writeFileSync(new URL(`./f3-${DESIGN}-N${N}.json`, import.meta.url), JSON.stringify({ DESIGN, N, off, out }));
console.log(`DESIGN=${DESIGN} N=${N}: ${out.length} سيناريو في ${((Date.now() - t0s) / 1000).toFixed(0)}s`);
