// gvariant.mjs — مقارنة قوة G_max بين مصدرين للبواقي: M1 (ميل) مقابل M0 (انحياز ثابت فقط)
import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { SIGMA_A } from "./lm.mjs";
import { fitM0, meanTimeMs } from "./models.mjs";
import { fitM1 } from "./models2.mjs";
const N = 9, TR = Number(process.env.TRIALS ?? 150);
const off = Array.from({ length: N }, (_, i) => (i * 480) / (N - 1));
const lat = 36.75, lon = 3.04, day = Date.UTC(2026, 10, 10);
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gaussOf = (rng) => () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function G(e) {
  let best = -Infinity;
  for (let c = 1; c < e.length; c++) {
    const a = e.slice(0, c), b = e.slice(c);
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
    best = Math.max(best, (ma - mb) ** 2 / (SIGMA_A ** 2 * (1 / a.length + 1 / b.length)));
  }
  return best;
}
const SC = [
  { k: "stable", sc: {} }, { k: "drift1", sc: { drift: 1 } }, { k: "drift3", sc: { drift: 3 } },
  { k: "outlier", sc: { outlier: 15 } }, { k: "jump8_mid", sc: { jump: 8, jc: 4 } }, { k: "jump12_mid", sc: { jump: 12, jc: 4 } },
  { k: "jump12_c2", sc: { jump: 12, jc: 2 } }, { k: "jump12_c7", sc: { jump: 12, jc: 7 } },
];
const res = {};
let seed = 777;
for (const s of SC) {
  const rng = mulberry32(seed++); const gs = gaussOf(rng);
  res[s.k] = { g0: [], g1: [], dA: [] };
  for (let i = 0; i < TR; i++) {
    const base = day + 7 * 3_600_000;
    const times = off.map((m) => base + m * 60_000);
    const tr = times.map((t) => solarPosition(t, lat, lon));
    const b0 = (rng() * 2 - 1) * 10;
    const oi = s.sc.outlier ? Math.floor(rng() * N) : -1;
    const meas = times.map((t, k) => {
      let A = tr[k].azimuthDeg + b0 + (s.sc.drift ? (s.sc.drift * (t - base)) / 3_600_000 : 0) + gs() * SIGMA_A;
      if (k === oi) A += 15;
      if (s.sc.jump && k >= s.sc.jc) A += s.sc.jump;
      return { utcMs: t, h: tr[k].altitudeDeg + gs(), A };
    });
    const m0 = fitM0(meas);
    const t0 = meanTimeMs(meas);
    const m1 = fitM1(meas, m0.p, t0);
    const e0 = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, m0.p[0], m0.p[1]).azimuthDeg - m0.p[2]));
    const e1 = meas.map((m) => wrapDeg(m.A - solarPosition(m.utcMs, m1.p[0], m1.p[1]).azimuthDeg - m1.p[2] - m1.p[3] * (m.utcMs - t0) / 3_600_000));
    res[s.k].g0.push(G(e0)); res[s.k].g1.push(G(e1));
    // تفضيل النموذج: AICc لـM0 (k=3) مقابل M1 (k=4)، n=2N
    const n = 2 * N, ac = (chi, k) => chi + 2 * k + (2 * k * (k + 1)) / (n - k - 1);
    res[s.k].dA.push(ac(m0.chi2, 3) - ac(m1.chi2, 4));
  }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const nj = ["stable", "drift1", "outlier"];
const tau = q(nj.flatMap((k) => res[k].g0), 0.99);
for (const tM of [0, 2, 4]) {
  console.log(`tM=${tM}, τ_G0=${tau.toFixed(1)}`);
  for (const k of ["stable", "drift3", "jump8_mid", "jump12_mid", "jump12_c2", "jump12_c7"]) {
    const r = res[k]; const n = r.g0.length;
    const cls = r.g0.map((g, i) => g <= tau ? (r.dA[i] > tM ? "DRIFT" : r.dA[i] < -tM ? "STABLE" : "SUSPECT") : (r.dA[i] > tM ? "JUMP_SUSPECT" : "JUMP"));
    const c = cls.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
    console.log(`  ${k}: ` + Object.entries(c).map(([a, b]) => `${a} ${((b / n) * 100).toFixed(0)}%`).join(", "));
  }
}
