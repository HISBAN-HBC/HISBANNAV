// اختبار بلا ضوضاء: b_A من −15 إلى +15، وقياس الإزاحة الفعلية للحل مقابل التنبؤ الخطي (C3).
import { solarPosition } from "../engine/hisban-engine.js";
import { cellCenters } from "../grid/hisban-grid.js";
import { rankCells, refine } from "../matcher/hisban-matcher.js";
import { haversineKm } from "../core/hisban-core.js";
const KM = 111.32;
const cases = [
  { name: "الجزائر N=2 Δ60", lat: 36.75, lon: 3.04, base: Date.UTC(2026, 10, 17, 7), off: [0, 60] },
  { name: "كامبالا N=4 Δ60", lat: 0.35, lon: 32.58, base: Date.UTC(2026, 2, 20, 7), off: [0, 60, 120, 180] },
  { name: "ترومسو N=2 Δ60", lat: 69.65, lon: 18.96, base: Date.UTC(2026, 5, 21, 7), off: [0, 60] },
];
const CELLS = cellCenters(5);
for (const c of cases) {
  const times = c.off.map((m) => c.base + m * 60_000);
  const truth = times.map((t) => solarPosition(t, c.lat, c.lon));
  console.log(`\n## ${c.name}`);
  console.log("b_A\tΔN(كم)\tΔE(كم)\tالخطأ(كم)");
  for (const b of [-15, -10, -5, 0, 5, 10, 15]) {
    const meas = times.map((t, k) => ({ utcMs: t, altitudeDeg: truth[k].altitudeDeg, azimuthDeg: truth[k].azimuthDeg + b, sigmaAlt: 1, sigmaAz: 3 }));
    const coarse = rankCells(CELLS, meas, 10);
    const best = refine(meas, coarse, { startStep: 5, minStep: 0.05, keep: 10 })[0];
    const dN = (best.lat - c.lat) * KM;
    const dE = (((best.lon - c.lon + 540) % 360) - 180) * KM * Math.cos((c.lat * Math.PI) / 180);
    console.log(`${b}\t${dN.toFixed(1)}\t${dE.toFixed(1)}\t${haversineKm(best.lat, best.lon, c.lat, c.lon).toFixed(1)}`);
  }
}
