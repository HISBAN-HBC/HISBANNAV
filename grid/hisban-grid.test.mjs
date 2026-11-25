import { test } from "node:test";
import assert from "node:assert/strict";
import { cellCenters, cellIndexOf } from "./hisban-grid.js";

test("5° grid has 36 × 72 = 2592 cells", () => {
  assert.equal(cellCenters(5).length, 2592);
});

test("cell centers are at ±2.5°, ±7.5°, … and lie inside the globe", () => {
  const c = cellCenters(5);
  for (const p of c) {
    assert.ok(p.lat > -90 && p.lat < 90);
    assert.ok(p.lon > -180 && p.lon < 180);
  }
  assert.ok(c.some((p) => p.lat === 2.5 && p.lon === -177.5));
});

test("Algiers (36.75, 3.04) falls in the cell centered at (37.5, 2.5)", () => {
  const idx = cellIndexOf(36.75, 3.04, 5);
  const c = cellCenters(5)[idx];
  assert.equal(c.lat, 37.5);
  assert.equal(c.lon, 2.5);
});

test("cellIndexOf handles the antimeridian and the poles", () => {
  const cells = cellCenters(5);
  assert.deepEqual(cells[cellIndexOf(0, 180, 5)], cells[cellIndexOf(0, -180, 5)]);
  assert.equal(cells[cellIndexOf(90, 0, 5)].lat, 87.5);
  assert.equal(cells[cellIndexOf(-90, 0, 5)].lat, -87.5);
});
