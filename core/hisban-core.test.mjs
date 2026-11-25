import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeg,
  haversineKm,
  initialBearingDeg,
  destinationPoint,
  qiblaBearing,
  hisbanAngle,
  angleToXY,
} from "./hisban-core.js";

const close = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? ""} expected ~${expected}, got ${actual}`
  );

test("normalizeDeg wraps into [0, 360)", () => {
  assert.equal(normalizeDeg(370), 10);
  assert.equal(normalizeDeg(-30), 330);
  assert.equal(normalizeDeg(360), 0);
});

test("haversine: one degree of longitude on the equator ≈ 111.19 km", () => {
  close(haversineKm(0, 0, 0, 1), 111.19, 0.05);
});

test("haversine: zero distance for identical points", () => {
  assert.equal(haversineKm(36.75, 3.04, 36.75, 3.04), 0);
});

test("bearing: cardinal directions from the equator", () => {
  close(initialBearingDeg(0, 0, 1, 0), 0, 1e-9, "north");
  close(initialBearingDeg(0, 0, 0, 1), 90, 1e-9, "east");
  close(initialBearingDeg(0, 0, -1, 0), 180, 1e-9, "south");
  close(initialBearingDeg(0, 0, 0, -1), 270, 1e-9, "west");
});

test("destinationPoint: moving east 111.19 km from the equator ≈ 1° east", () => {
  const p = destinationPoint(0, 0, 90, 111.19);
  close(p.lat, 0, 1e-6);
  close(p.lon, 1, 0.01);
});

test("destination and bearing/distance round-trip", () => {
  const start = { lat: 36.75, lon: 3.04 };
  const bearing = 62;
  const dist = 250;
  const end = destinationPoint(start.lat, start.lon, bearing, dist);
  close(haversineKm(start.lat, start.lon, end.lat, end.lon), dist, 0.01, "distance");
  close(initialBearingDeg(start.lat, start.lon, end.lat, end.lon), bearing, 0.01, "bearing");
});

test("qibla from Algiers ≈ 105°, close to the app reading 105.5°", () => {
  close(qiblaBearing(36.75, 3.04), 105.3, 0.5);
});

test("hisbanAngle: 15° per hour from sunrise", () => {
  const sunrise = Date.UTC(2026, 10, 10, 6, 20, 2);
  const now = sunrise + 6 * 3_600_000;
  close(hisbanAngle(now, sunrise), 90, 1e-9);
});

test("hisbanAngle: wraps after 24 hours", () => {
  const sunrise = Date.UTC(2026, 10, 10, 6, 20, 2);
  const now = sunrise + 25 * 3_600_000;
  close(hisbanAngle(now, sunrise), 15, 1e-9);
});

test("angleToXY: 0° is top, 90° is right, 180° is bottom", () => {
  let p = angleToXY(0, 100, 150, 150);
  close(p.x, 150, 1e-9);
  close(p.y, 50, 1e-9);
  p = angleToXY(90, 100, 150, 150);
  close(p.x, 250, 1e-9);
  close(p.y, 150, 1e-9);
  p = angleToXY(180, 100, 150, 150);
  close(p.x, 150, 1e-9);
  close(p.y, 250, 1e-9);
});
