import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition } from "../engine/hisban-engine.js";
import { cellCenters } from "../grid/hisban-grid.js";
import { wrapDeg, chiSquare, rankCells, refine } from "./hisban-matcher.js";

// ثلاث حالات مختلفة جداً
const SITES = [
  { name: "Algiers", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10) },
  { name: "Kampala (near equator)", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20) },
  { name: "Tromsø (high latitude)", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21) },
];

// قياسات تركيبية مستقلة في وقتين من اليوم (بالتوقيت العالمي)، بلا ضوضاء
function syntheticMeasurements(site) {
  return [7, 10].map((h) => {
    const utcMs = site.day + h * 3_600_000;
    const p = solarPosition(utcMs, site.lat, site.lon);
    return { utcMs, altitudeDeg: p.altitudeDeg, azimuthDeg: p.azimuthDeg, sigmaAlt: 1, sigmaAz: 3 };
  });
}

test("wrapDeg uses the circular difference", () => {
  assert.equal(wrapDeg(350 - 10), -20);
  assert.equal(wrapDeg(10 - 350), 20);
  assert.equal(wrapDeg(180), -180);
});

test("chi-square is zero at the true location (exact measurements)", () => {
  for (const s of SITES) {
    assert.ok(chiSquare(s.lat, s.lon, syntheticMeasurements(s)) < 1e-6, s.name);
  }
});

for (const s of SITES) {
  test(`${s.name}: coarse 5° ranking puts the true cell in the top 10`, () => {
    const cells = cellCenters(5);
    const top = rankCells(cells, syntheticMeasurements(s), 10);
    const cellSize = 5;
    const near = top.some(
      (c) => Math.abs(c.lat - s.lat) <= cellSize && Math.abs(wrapDeg(c.lon - s.lon)) <= cellSize
    );
    assert.ok(near, `top cells: ${JSON.stringify(top.slice(0, 3))}`);
  });

  test(`${s.name}: hierarchical refine converges to within 0.1° (exact measurements)`, () => {
    const cells = cellCenters(5);
    const m = syntheticMeasurements(s);
    const top = rankCells(cells, m, 10);
    const best = refine(m, top, { startStep: 5, minStep: 0.05, keep: 20 })[0];
    assert.ok(Math.abs(best.lat - s.lat) <= 0.1, `lat ${best.lat} vs ${s.lat}`);
    assert.ok(Math.abs(wrapDeg(best.lon - s.lon)) <= 0.1, `lon ${best.lon} vs ${s.lon}`);
  });
}

test("probabilities over the coarse grid sum to 1", () => {
  const s = SITES[0];
  const cells = cellCenters(5);
  const all = rankCells(cells, syntheticMeasurements(s), cells.length);
  const sum = all.reduce((a, c) => a + c.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum}`);
});
