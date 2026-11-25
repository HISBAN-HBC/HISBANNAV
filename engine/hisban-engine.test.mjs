import { test } from "node:test";
import assert from "node:assert/strict";
import {
  solarParams,
  sunEvents,
  longitudeFromSolarNoon,
  latitudeCandidates,
} from "./hisban-engine.js";

const ALGIERS = { lat: 36.75, lon: 3.04 };
const NOV_10_2026 = Date.UTC(2026, 10, 10, 12);
const MIN = 60_000;

const minutesOfDay = (ms) => {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
};

test("declination: near zero at the March equinox", () => {
  const { declinationDeg } = solarParams(Date.UTC(2026, 2, 20, 12));
  assert.ok(Math.abs(declinationDeg) < 0.5, `got ${declinationDeg}`);
});

test("declination: about +23.4° at the June solstice", () => {
  const { declinationDeg } = solarParams(Date.UTC(2026, 5, 21, 12));
  assert.ok(Math.abs(declinationDeg - 23.44) < 0.3, `got ${declinationDeg}`);
});

test("equation of time: about +16 minutes in early November (solar noon ≈ 11:44 UTC)", () => {
  const { eotMin } = solarParams(NOV_10_2026);
  assert.ok(Math.abs(eotMin - 16.4) < 0.5, `got ${eotMin}`);
});

test("Algiers, 10 Nov 2026: sunrise ≈ 06:20 UTC and sunset ≈ 16:42 UTC (±3 min)", () => {
  const ev = sunEvents(NOV_10_2026, ALGIERS.lat, ALGIERS.lon);
  assert.equal(ev.polar, null);
  assert.ok(Math.abs(minutesOfDay(ev.sunriseUtc) - (6 * 60 + 20)) <= 3, `sunrise ${new Date(ev.sunriseUtc).toISOString()}`);
  assert.ok(Math.abs(minutesOfDay(ev.sunsetUtc) - (16 * 60 + 42)) <= 3, `sunset ${new Date(ev.sunsetUtc).toISOString()}`);
});

test("source is always tagged as CALCULATED", () => {
  const ev = sunEvents(NOV_10_2026, ALGIERS.lat, ALGIERS.lon);
  assert.equal(ev.source, "CALCULATED");
});

test("longitude from solar noon recovers Algiers (±0.15°)", () => {
  const ev = sunEvents(NOV_10_2026, ALGIERS.lat, ALGIERS.lon);
  const lon = longitudeFromSolarNoon(ev.solarNoonUtc, NOV_10_2026);
  assert.ok(Math.abs(lon - ALGIERS.lon) <= 0.15, `got ${lon}`);
});

test("latitude candidates from day length include Algiers (±1°)", () => {
  const ev = sunEvents(NOV_10_2026, ALGIERS.lat, ALGIERS.lon);
  const cands = latitudeCandidates(NOV_10_2026, ev.dayLengthMin);
  assert.ok(
    cands.some((c) => Math.abs(c - ALGIERS.lat) <= 1),
    `candidates ${JSON.stringify(cands)}`
  );
});

test("polar day at 80°N near the June solstice", () => {
  const ev = sunEvents(Date.UTC(2026, 5, 21, 12), 80, 0);
  assert.equal(ev.polar, "day");
  assert.equal(ev.sunriseUtc, null);
});

test("polar night at 80°N near the December solstice", () => {
  const ev = sunEvents(Date.UTC(2026, 11, 21, 12), 80, 0);
  assert.equal(ev.polar, "night");
  assert.equal(ev.sunriseUtc, null);
});

test("latitude candidates: invalid day length returns empty list", () => {
  assert.deepEqual(latitudeCandidates(NOV_10_2026, 0), []);
  assert.deepEqual(latitudeCandidates(NOV_10_2026, 1440), []);
});
