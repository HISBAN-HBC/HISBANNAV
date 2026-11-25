// fixtures.mjs — مجموعة ثابتة من السيناريوهات للتكافؤ الذهبي بين المختبر والمنتج.
// كل سيناريو حتمي: الضوضاء تُولَّد بمُولِّد ثابت البذرة. لا تُعدَّل هذه القيم دون تحديث الملف الذهبي.
import { solarPosition } from "../../engine/hisban-engine.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussFactory(rng) {
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** @type {Array<{id:string, lat:number, lon:number, startUtcMs:number, offsetsMin:number[], bias:number, noiseSeed?:number, sigmaAz?:number[], labCompatible:boolean, note:string}>} */
export const SCENARIOS = [
  { id: "clean", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: 0, labCompatible: true, note: "حل نظيف بلا ضوضاء ولا انحياز" },
  { id: "bias_const_7", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: 7, labCompatible: true, note: "انحياز ثابت داخل الحدود" },
  { id: "bias_near_bound", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: 18, labCompatible: true, note: "انحياز قرب حد ±20°" },
  { id: "bias_negative_near_bound", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: -18.5, labCompatible: true, note: "انحياز سالب قرب الحد" },
  { id: "weak_short_span", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 30, 60], bias: 5, labCompatible: true, note: "نافذة قصيرة، هندسة ضعيفة" },
  { id: "near_equator", lat: 0.5, lon: 10, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: 4, labCompatible: true, note: "قرب خط الاستواء" },
  { id: "lon_near_plus180", lat: 20, lon: 179.5, startUtcMs: Date.UTC(2026, 10, 10, 1), offsetsMin: [0, 120, 240, 360, 480], bias: -6, labCompatible: true, note: "خط طول قرب +180°" },
  { id: "lon_near_minus180", lat: -15, lon: -179.2, startUtcMs: Date.UTC(2026, 10, 10, 1), offsetsMin: [0, 120, 240, 360, 480], bias: 6, labCompatible: true, note: "خط طول قرب −180°" },
  { id: "azimuth_wrap_south", lat: -35, lon: 150, startUtcMs: Date.UTC(2026, 10, 10, 1) + 46 * 60_000, offsetsMin: [0, 30, 60, 90, 120], bias: 4, labCompatible: true, note: "قياس أول: السمت الحقيقي 358.3° والمرصود بعد الانحياز 2.3° (عبور 360 داخل بقايا واحدة)" },
  { id: "noisy_seed_42", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: 5, noiseSeed: 42, labCompatible: true, note: "ضوضاء حتمية σ_h=1، σ_A=3" },
  { id: "per_measurement_sigma", lat: 36.75, lon: 3.04, startUtcMs: Date.UTC(2026, 10, 10, 7), offsetsMin: [0, 120, 240, 360, 480], bias: 5, sigmaAz: [3, 6, 3, 6, 3], labCompatible: false, note: "σ مختلفة لكل قياس: المختبر يفترض ثابتاً، لذلك لا يُقارَن" },
];

/** يبني القياسات بالحقول العامة (altitudeDeg, azimuthDeg, sigmaAlt, sigmaAz). */
export function buildMeasurements(s) {
  const rng = mulberry32(s.noiseSeed ?? 1);
  const gauss = gaussFactory(rng);
  return s.offsetsMin.map((m, k) => {
    const utcMs = s.startUtcMs + m * 60_000;
    const truth = solarPosition(utcMs, s.lat, s.lon);
    const noisy = s.noiseSeed !== undefined;
    const sAz = s.sigmaAz ? s.sigmaAz[k] : 3;
    const h = truth.altitudeDeg + (noisy ? gauss() * 1 : 0);
    const A = truth.azimuthDeg + s.bias + (noisy ? gauss() * sAz : 0);
    return { utcMs, altitudeDeg: h, azimuthDeg: ((A % 360) + 360) % 360, sigmaAlt: 1, sigmaAz: sAz };
  });
}
