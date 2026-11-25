import { test } from "node:test";
import assert from "node:assert/strict";
import { solarPosition, sunEvents } from "./hisban-engine.js";

test("Algiers, 10 Nov 2026, local noon: altitude ≈ 35° and azimuth ≈ 180° (±1.5°)", () => {
  const lat = 36.75, lon = 3.04;
  const day = Date.UTC(2026, 10, 10, 12);
  const noon = sunEvents(day, lat, lon).solarNoonUtc;
  const p = solarPosition(noon, lat, lon);
  assert.ok(Math.abs(p.altitudeDeg - 35.1) <= 1.5, `altitude ${p.altitudeDeg}`);
  assert.ok(Math.abs(p.azimuthDeg - 180) <= 1.5, `azimuth ${p.azimuthDeg}`);
});

test("Kampala (near equator), 20 Mar 2026, local noon: altitude > 88°", () => {
  const lat = 0.35, lon = 32.58;
  const day = Date.UTC(2026, 2, 20, 12);
  const noon = sunEvents(day, lat, lon).solarNoonUtc;
  const p = solarPosition(noon, lat, lon);
  assert.ok(p.altitudeDeg > 88, `altitude ${p.altitudeDeg}`);
});

test("Tromsø (high latitude), 21 Jun 2026, solar midnight: midnight sun altitude ≈ 3.1° (±1°)", () => {
  const lat = 69.65, lon = 18.96;
  const day = Date.UTC(2026, 5, 21, 12);
  const noon = sunEvents(day, lat, lon).solarNoonUtc;
  const midnight = noon + 12 * 3_600_000;
  const p = solarPosition(midnight, lat, lon);
  assert.ok(Math.abs(p.altitudeDeg - 3.1) <= 1, `altitude ${p.altitudeDeg}`);
  assert.ok(p.altitudeDeg > 0, "midnight sun should stay above the horizon");
});

test("azimuth is in [0, 360)", () => {
  const p = solarPosition(Date.UTC(2026, 10, 10, 8), 36.75, 3.04);
  assert.ok(p.azimuthDeg >= 0 && p.azimuthDeg < 360);
});
