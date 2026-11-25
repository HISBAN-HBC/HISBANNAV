// identifiability.mjs — المرحلة B1: هل يمكن فصل الانحياز b_A عن الموقع (φ, λ)؟
// مصفوفة Fisher ثلاثية: x = (φ, λ, b_A). σh = 1°، σA حسب الوسيطة. الزوايا بالدرجات.
// الحالات: Observable (يُقدَّر الموقع والانحياز)، Position-only (الموقع فقط)، Unobservable (الهندسة غير كافية).

import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";

const KM = 111.32;
const SIGMA_H = 1;
const SIGMA_A = Number(process.env.SIGMA_A ?? 3);
const SIGMA_B_PRIOR = Number(process.env.SIGMA_B_PRIOR ?? 5); // prior: b_A ~ N(0, 5°)
const SIGMA_B_OK = 2; // معايرة مقبولة إذا كان σ_b ≤ 2°
const e = 0.01;

const SITES = [
  { name: "الجزائر", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10) },
  { name: "كامبالا", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20) },
  { name: "ترومسو", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21) },
];
const BASE_H = 7;

// ---------- جاكوبيان قياس واحد (3 معاملات) ----------
function rowsAt(t, lat, lon) {
  const hp = solarPosition(t, lat + e, lon), hm = solarPosition(t, lat - e, lon);
  const lp = solarPosition(t, lat, lon + e), lm = solarPosition(t, lat, lon - e);
  const dhdphi = (hp.altitudeDeg - hm.altitudeDeg) / (2 * e);
  const dhdlam = (lp.altitudeDeg - lm.altitudeDeg) / (2 * e);
  const dAdphi = wrapDeg(hp.azimuthDeg - hm.azimuthDeg) / (2 * e);
  const dAdlam = wrapDeg(lp.azimuthDeg - lm.azimuthDeg) / (2 * e);
  return { h: [dhdphi, dhdlam, 0], A: [dAdphi, dAdlam, 1] };
}

// F = Σ JᵀΣ⁻¹J (3×3)
function fisher3(site, times, sigmaA, prior = false) {
  const F = Array.from({ length: 3 }, () => [0, 0, 0]);
  const wh = 1 / (SIGMA_H * SIGMA_H), wa = 1 / (sigmaA * sigmaA);
  for (const t of times) {
    const { h, A } = rowsAt(t, site.lat, site.lon);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) F[i][j] += wh * h[i] * h[j] + wa * A[i] * A[j];
  }
  if (prior) F[2][2] += 1 / (SIGMA_B_PRIOR * SIGMA_B_PRIOR);
  return F;
}

// معكوس 3×3 بطريقة المرافقات، ومحدد
function inv3(M) {
  const [[a, b, c], [d, e2, f], [g, h, i]] = M;
  const A = e2 * i - f * h, B = -(d * i - f * g), C = d * h - e2 * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-14)) return { inv: null, det };
  const D = -(b * i - c * h), E = a * i - c * g, Fm = -(a * h - b * g);
  const G = b * f - c * e2, H = -(a * f - c * d), I = a * e2 - b * d;
  const inv = [
    [A / det, D / det, G / det],
    [B / det, E / det, H / det],
    [C / det, Fm / det, I / det],
  ];
  return { inv, det };
}

// القيم الذاتية لمصفوفة متماثلة 3×3 بطريقة Jacobi
function eigenSym3(M) {
  const a = M.map((r) => r.slice());
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s2 = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s2 * akq; a[k][q] = s2 * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s2 * aqk; a[q][k] = s2 * apk + c * aqk;
      }
    }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => y - x);
}

// تحليل قابلية الرصد لمجموعة أوقات
function analyzeIdentifiability(site, times, sigmaA, prior = false) {
  const F = fisher3(site, times, sigmaA, prior);
  const { inv, det } = inv3(F);
  const ev = eigenSym3(F);
  const lmin = Math.min(...ev), lmax = Math.max(...ev);
  const kappa = lmin > 1e-12 ? lmax / lmin : Infinity;
  if (!inv) return { status: "Unobservable", sigmaB: Infinity, rhoLam: NaN, rhoPhi: NaN, sigmaPosKm: Infinity, kappa };
  const C = inv;
  const sigmaB = Math.sqrt(Math.max(0, C[2][2]));
  const rhoPhi = C[0][2] / Math.sqrt(C[0][0] * C[2][2]);
  const rhoLam = C[1][2] / Math.sqrt(C[1][1] * C[2][2]);
  const cosφ = Math.max(Math.cos((site.lat * Math.PI) / 180), 1e-6);
  const sigmaPosKm = Math.sqrt(Math.max(0, (C[0][0] + C[1][1] * cosφ * cosφ) * KM * KM));
  let status;
  if (lmin < 1e-9 || !Number.isFinite(sigmaB)) status = "Unobservable";
  else if (sigmaB <= SIGMA_B_OK && Math.abs(rhoLam) < 0.9 && Math.abs(rhoPhi) < 0.9) status = "Observable";
  else status = "Position-only";
  return { status, sigmaB, rhoLam, rhoPhi, sigmaPosKm, kappa, lmin };
}

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "∞");
const out = [];
out.push(`σA = ${SIGMA_A}°، σh = ${SIGMA_H}°، معيار المعايرة: σ_b ≤ ${SIGMA_B_OK}° وإلا ضعيفة\n`);

for (const site of SITES) {
  out.push(`## ${site.name}`);
  out.push("| N | الفاصل (د) | σ_b (°) | ρ_bφ | ρ_bλ | κ | σ_موقع (كم) | الحالة (بدون prior) | الحالة (مع prior 5°) |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  const base = site.day + BASE_H * 3_600_000;
  const configs = [];
  for (const N of [2, 3, 4, 5]) for (const sp of [30, 60, 120]) configs.push({ N, sp });
  for (const { N, sp } of configs) {
    const times = Array.from({ length: N }, (_, k) => base + k * sp * 60_000);
    // تحقق: الأوقات فوق الأفق وبعيدة عن السمت
    const vis = times.every((t) => {
      const p = solarPosition(t, site.lat, site.lon);
      return p.altitudeDeg >= 5 && p.altitudeDeg <= 80;
    });
    if (!vis) {
      out.push(`| ${N} | ${sp} | — | — | — | — | — | غير مرئي/قرب السمت | — |`);
      continue;
    }
    const a = analyzeIdentifiability(site, times, SIGMA_A, false);
    const p = analyzeIdentifiability(site, times, SIGMA_A, true);
    out.push(`| ${N} | ${sp} | ${fmt(a.sigmaB)} | ${fmt(a.rhoPhi, 2)} | ${fmt(a.rhoLam, 2)} | ${fmt(a.kappa, 0)} | ${fmt(a.sigmaPosKm, 0)} | ${a.status} | ${p.status} (σ_b=${fmt(p.sigmaB)}) |`);
  }
  out.push("");
}
console.log(out.join("\n"));
