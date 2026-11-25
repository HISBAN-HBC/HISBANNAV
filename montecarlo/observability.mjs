// observability.mjs — المرحلة C: قابلية الرصد الزمنية لكل موقع.
//  C1: خريطة قابلية الرصد لحظة بلحظة (Jacobian → Fisher → λmin/λmax/κ/C).
//  C2: أفضل توقيت للقياس التالي بعد قياس أول (تكرار جشع على σ_worst).
//  C3: انحياز السمت كيف يتحول إلى إزاحة جغرافية (متجه الانزياح لكل درجة انحياز).
// الأرقام تحليلية (بدون ضوضاء). σh=1°، وσA حسب الوسيطة.

import { solarPosition, sunEvents } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";

const KM = 111.32;
const SIGMA_H = 1;
const SIGMA_A = Number(process.env.SIGMA_A ?? 3); // الافتراض النظامي
const MIN_ALT = 5; // قياس الشمس يحتاج ارتفاعاً مرئياً (درجات)
const MAX_ALT = 80; // قرب السمت يصبح السمت غير معرّف، فيُستبعد
const e = 0.01;

const SITES = [
  { name: "الجزائر", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 17) },
  { name: "كامبالا", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20) },
  { name: "ترومسو", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21) },
];

// ---------- Jacobian لقياس واحد ----------
// يعيد صفاً للارتفاع وصفاً للسمت: [∂/∂φ, ∂/∂λ] بالدرجات لكل درجة
function jacobianAt(t, lat, lon) {
  const hp = solarPosition(t, lat + e, lon), hm = solarPosition(t, lat - e, lon);
  const lp = solarPosition(t, lat, lon + e), lm = solarPosition(t, lat, lon - e);
  const Jh = [(hp.altitudeDeg - hm.altitudeDeg) / (2 * e), (lp.altitudeDeg - lm.altitudeDeg) / (2 * e)];
  const JA = [wrapDeg(hp.azimuthDeg - hm.azimuthDeg) / (2 * e), wrapDeg(lp.azimuthDeg - lm.azimuthDeg) / (2 * e)];
  const pos = solarPosition(t, lat, lon);
  return { Jh, JA, altitude: pos.altitudeDeg, azimuth: pos.azimuthDeg };
}

// F = Σ JᵀΣ⁻¹J (2×2، بوحدات درجة⁻²)
function fisherOf(site, times, sigmaA = SIGMA_A) {
  const F = [[0, 0], [0, 0]];
  const wh = 1 / (SIGMA_H * SIGMA_H), wa = 1 / (sigmaA * sigmaA);
  for (const t of times) {
    const { Jh, JA } = jacobianAt(t, site.lat, site.lon);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) F[i][j] += wh * Jh[i] * Jh[j] + wa * JA[i] * JA[j];
  }
  return F;
}

// تحليل F: التغاير C=F⁻¹ بالكيلومتر، القيم الذاتية، الاتجاه الأضعف، κ
function analyze(F, latDeg) {
  const det = F[0][0] * F[1][1] - F[0][1] * F[1][0];
  if (!(det > 1e-12)) return null;
  const C = [[F[1][1] / det, -F[0][1] / det], [-F[1][0] / det, F[0][0] / det]]; // درجة²
  const cosφ = Math.max(Math.cos((latDeg * Math.PI) / 180), 1e-6);
  const S = [KM, KM * cosφ];
  const Ck = [
    [C[0][0] * S[0] * S[0], C[0][1] * S[0] * S[1]],
    [C[1][0] * S[1] * S[0], C[1][1] * S[1] * S[1]],
  ];
  const tr = Ck[0][0] + Ck[1][1];
  const disc = Math.sqrt(Math.max(0, ((Ck[0][0] - Ck[1][1]) / 2) ** 2 + Ck[0][1] * Ck[0][1]));
  const l1 = tr / 2 + disc; // أكبر تباين (أضعف اتجاه)
  const l2 = Math.max(tr / 2 - disc, 1e-9);
  // المتجه الذاتي للتباين الأكبر (الاتجاه الأضعف): (x=شمال–جنوب، y=شرق–غرب) بالكيلومتر
  let vN, vE;
  if (Math.abs(Ck[0][1]) > 1e-12) {
    vN = Ck[0][1]; vE = l1 - Ck[0][0];
  } else {
    vN = Ck[0][0] >= Ck[1][1] ? 1 : 0; vE = vN ? 0 : 1;
  }
  const norm = Math.hypot(vN, vE) || 1;
  const shareNS = (vN / norm) ** 2;
  return {
    sigmaWorstKm: Math.sqrt(l1),
    sigmaBestKm: Math.sqrt(l2),
    sigmaRadialKm: Math.sqrt(tr),
    kappa: l1 / l2,
    weakNS: shareNS, // نسبة الضعف الواقعة في خط العرض (شمال–جنوب)
    weakLabel: shareNS > 0.7 ? "شمال–جنوب" : shareNS < 0.3 ? "شرق–غرب" : "مختلط",
  };
}

const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "∞");
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

// ---------- C1: قابلية كل لحظة وحدها ----------
function c1(site) {
  const base = site.day;
  const rows = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const t = base + m * 60_000;
    const pos = solarPosition(t, site.lat, site.lon);
    if (pos.altitudeDeg < MIN_ALT || pos.altitudeDeg > MAX_ALT) continue;
    const a = analyze(fisherOf(site, [t]), site.lat);
    if (a) rows.push({ t, alt: pos.altitudeDeg, ...a });
  }
  return rows;
}

// ---------- C2: أفضل توقيت للقياس التالي ----------
// لكل توقيت قياس أول t1، نبحث عن t2 يعطي أصغر σ_worst للزوج معاً.
function c2(site, t1) {
  let best = null;
  const F1 = fisherOf(site, [t1]);
  for (let m = 10; m <= 12 * 60; m += 5) {
    const t2 = t1 + m * 60_000;
    const pos = solarPosition(t2, site.lat, site.lon);
    if (pos.altitudeDeg < MIN_ALT || pos.altitudeDeg > MAX_ALT) continue;
    const F2 = fisherOf(site, [t2]);
    const F = [
      [F1[0][0] + F2[0][0], F1[0][1] + F2[0][1]],
      [F1[1][0] + F2[1][0], F1[1][1] + F2[1][1]],
    ];
    const a = analyze(F, site.lat);
    if (a && (!best || a.sigmaWorstKm < best.sigmaWorstKm)) best = { delayMin: m, ...a };
  }
  return best;
}

// ---------- C3: الانحياز ↔ الإزاحة الجغرافية ----------
// Δx = F⁻¹ g،  g = Σ (∂A/∂φ, ∂A/∂λ)/σA²  (لكل درجة انحياز)
function biasShift(site, times) {
  const F = fisherOf(site, times);
  const det = F[0][0] * F[1][1] - F[0][1] * F[1][0];
  if (!(det > 1e-12)) return null;
  let g = [0, 0];
  for (const t of times) {
    const { JA } = jacobianAt(t, site.lat, site.lon);
    g[0] += JA[0] / (SIGMA_A * SIGMA_A);
    g[1] += JA[1] / (SIGMA_A * SIGMA_A);
  }
  const dPhi = (F[1][1] * g[0] - F[0][1] * g[1]) / det; // درجة لكل درجة انحياز
  const dLam = (-F[1][0] * g[0] + F[0][0] * g[1]) / det;
  const cosφ = Math.max(Math.cos((site.lat * Math.PI) / 180), 1e-6);
  return { kmNorthPerDeg: dPhi * KM, kmEastPerDeg: dLam * KM * cosφ };
}

// ---------- التشغيل ----------
const out = [];
for (const site of SITES) {
  const rows = c1(site);
  const worst = rows.reduce((a, b) => (b.sigmaWorstKm > a.sigmaWorstKm ? b : a), rows[0]);
  const best = rows.reduce((a, b) => (b.sigmaWorstKm < a.sigmaWorstKm ? b : a), rows[0]);
  out.push(`\n## ${site.name}`);
  out.push(`ساعات مرئية (ارتفاع ≥ ${MIN_ALT}°): ${rows.length} لحظة من ${48}`);
  if (best) out.push(`أفضل لحظة منفردة: ${hhmm(best.t)} UTC، σ_worst=${fmt(best.sigmaWorstKm)} كم، κ=${fmt(best.kappa, 1)}، الضعف: ${best.weakLabel}`);
  if (worst) out.push(`أضعف لحظة منفردة: ${hhmm(worst.t)} UTC، σ_worst=${fmt(worst.sigmaWorstKm)} كم، κ=${fmt(worst.kappa, 1)}، الضعف: ${worst.weakLabel}`);

  // جدول مختصر كل ساعتين
  out.push("| UTC | الارتفاع | σ_worst (كم) | σ_best (كم) | κ | الضعف |");
  out.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    if (new Date(r.t).getUTCMinutes() !== 0) continue;
    out.push(`| ${hhmm(r.t)} | ${fmt(r.alt, 1)}° | ${fmt(r.sigmaWorstKm)} | ${fmt(r.sigmaBestKm)} | ${fmt(r.kappa, 1)} | ${r.weakLabel} |`);
  }

  // C2: أفضل قياس تالٍ بعد قياس أول في ساعات مختارة
  out.push("\nC2 — بعد قياس أول في الوقت المعطى، أفضل توقيت للقياس الثاني:");
  out.push("| القياس الأول | أفضل تأخير | σ_worst للزوج (كم) | κ |");
  out.push("|---|---|---|---|");
  for (const r of rows.filter((x) => new Date(x.t).getUTCMinutes() === 0).slice(0, 12)) {
    const b = c2(site, r.t);
    if (b) out.push(`| ${hhmm(r.t)} | بعد ${b.delayMin} د | ${fmt(b.sigmaWorstKm)} | ${fmt(b.kappa, 1)} |`);
  }

  // C3: متجه الانزياح لكل درجة انحياز (نفس أوقات تجربة N=2 بفاصل 60)
  const t0 = site.day + 7 * 3_600_000;
  for (const [label, times] of [
    ["N=2، فاصل 60 د", [t0, t0 + 3_600_000]],
    ["N=4، فاصل 60 د", [0, 1, 2, 3].map((k) => t0 + k * 3_600_000)],
    ["N=4، فاصل 120 د", [0, 1, 2, 3].map((k) => t0 + k * 7_200_000)],
  ]) {
    const s = biasShift(site, times);
    if (s) out.push(`C3 (${label}): كل 1° انحياز سمت ⇒ إزاحة شمال ${fmt(s.kmNorthPerDeg, 1)} كم، شرق ${fmt(s.kmEastPerDeg, 1)} كم`);
  }
}
console.log(out.join("\n"));
