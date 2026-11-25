// detect-d.mjs — معايرة كاشف البقايا: D (ميل السمت) و CUSUM على |r|/σ_A
import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { estimate, SIGMA_A } from "./lm.mjs";

const TRIALS = Number(process.env.TRIALS ?? 300);
const cfg = { lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360, 480] };
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gaussOf = (rng) => () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function trial(sc, rng, gauss) {
  const base = cfg.day + 7 * 3_600_000;
  const times = cfg.off.map((m) => base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, cfg.lat, cfg.lon));
  const b0 = (rng() * 2 - 1) * 10;
  
  const N = times.length;
  const outIdx = sc.outlier ? Math.floor(rng() * N) : -1;
  const outSign = rng() < 0.5 ? -1 : 1;
  const meas = times.map((t, k) => {
    let A = truth[k].azimuthDeg + b0 + (sc.drift ? (sc.drift * (t - base)) / 3_600_000 : 0) + gauss() * (sc.sA ?? SIGMA_A);
    if (k === outIdx) A += outSign * sc.outlier;
    if (sc.jump && k >= Math.floor(N / 2)) A += sc.jump;
    return { utcMs: t, h: truth[k].altitudeDeg + gauss(), A };
  });
  const { best } = estimate(meas, null);
  const tH = meas.map((m) => (m.utcMs - base) / 3_600_000);
  const rA = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, best.p[0], best.p[1]).azimuthDeg - best.p[2]));
  const k = N, tb = tH.reduce((s, x) => s + x, 0) / k, rb = rA.reduce((s, x) => s + x, 0) / k;
  const Stt = tH.reduce((s, x) => s + (x - tb) ** 2, 0);
  const slope = tH.reduce((s, x, i) => s + (x - tb) * (rA[i] - rb), 0) / Stt;
  const D = Math.abs(slope) / (SIGMA_A / Math.sqrt(Stt));
  // CUSUM ثنائي الاتجاه على المخلفات المعيارية (نسبة إلى σ_A)؛ مرجعيته k=0.5
  const z = rA.map((x) => x / SIGMA_A);
  let Sp = 0, Sn = 0, maxS = 0;
  for (const zi of z) { Sp = Math.max(0, Sp + zi - 0.5); Sn = Math.max(0, Sn - zi - 0.5); maxS = Math.max(maxS, Sp, Sn); }
  return { D, S: maxS };
}

const SCEN = [
  { key: "null", label: "بلا انحراف (أساس)", sc: {} },
  { key: "sA5", label: "σ_A=5 بلا انحراف", sc: { sA: 5 } },
  { key: "out", label: "شذوذ منفرد 15°", sc: { outlier: 15 } },
  { key: "jump", label: "قفزة +8°", sc: { jump: 8 } },
  { key: "d1", label: "انحراف 1°/س", sc: { drift: 1 } },
  { key: "d2", label: "انحراف 2°/س", sc: { drift: 2 } },
  { key: "d3", label: "انحراف 3°/س", sc: { drift: 3 } },
  { key: "d5", label: "انحراف 5°/س", sc: { drift: 5 } },
];
const TH_D = [2, 3];
const TH_S = [4, 6, 8];
const f = (x) => (x * 100).toFixed(1) + "%";
console.log("| السيناريو | " + TH_D.map((t) => `D≥${t}`).join(" | ") + " | " + TH_S.map((t) => `CUSUM>${t}`).join(" | ") + " |");
console.log("|" + "---|".repeat(1 + TH_D.length + TH_S.length));
for (const s of SCEN) {
  const rng = mulberry32(4242 + s.key.length * 17 + s.key.charCodeAt(0)); const gauss = gaussOf(rng);
  const R = Array.from({ length: TRIALS }, () => trial(s.sc, rng, gauss));
  const cells = [...TH_D.map((t) => R.filter((x) => x.D >= t).length / TRIALS), ...TH_S.map((t) => R.filter((x) => x.S > t).length / TRIALS)];
  console.log(`| ${s.label} | ${cells.map(f).join(" | ")} |`);
}
