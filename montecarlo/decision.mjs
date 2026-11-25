// decision.mjs — قاعدة القرار بأربعة أوضاع:
//   Joint              : المعايرة المشتركة آمنة ومفيدة
//   Conditional Joint  : مفيدة، لكن خطر الفشل يحتاج مراقبة وقت التشغيل
//   Position-only      : تقدير الموقع أفضل من محاولة تقدير الانحياز
//   Unobservable       : الهندسة غير كافية للموقع
// الفشل يُقاس بحد أعلى لمجال ثقة 95% (Wilson) لا بالنسبة الخام فقط.
// التشغيل: node decision.mjs

import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";

// ---------- العتبات ----------
export const THRESHOLDS = {
  sigmaPosKm: 300,  // أقصى عدم يقين موقع قبل اعتبار الإعداد غير قابل للرصد
  sigmaB: 2,        // أقصى σ_b للمعايرة (درجة)
  rhoMax: 0.9,      // أقصى |ρ| بين b_A والموقع
  gain: 0.15,       // أدنى كسب المعايرة: (P95_بدون − P95_مشترك)/P95_بدون
  failTarget: 0.05, // هدف السلامة للمعايرة المشتركة
  failCeiling: 0.10,// سقف أقصى لا يجوز تجاوزه
};

const KM = 111.32;
const e = 0.01;

// ---------- مجال الثقة للفشل (Wilson، 95%) ----------
export function wilsonUpper(k, n, z = 1.6449) {
  // z = 1.6449 للحد الأعلى أحادي الجانب عند 95%
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, (center + margin) / denom);
}

// ---------- Fisher ثلاثي ----------
function jac(t, lat, lon) {
  const hp = solarPosition(t, lat + e, lon), hm = solarPosition(t, lat - e, lon);
  const lp = solarPosition(t, lat, lon + e), lm = solarPosition(t, lat, lon - e);
  return {
    h: [(hp.altitudeDeg - hm.altitudeDeg) / (2 * e), (lp.altitudeDeg - lm.altitudeDeg) / (2 * e), 0],
    A: [wrapDeg(hp.azimuthDeg - hm.azimuthDeg) / (2 * e), wrapDeg(lp.azimuthDeg - lm.azimuthDeg) / (2 * e), 1],
  };
}
function inv3(M) {
  const [[a, b, c], [d, e2, f], [g, h, i]] = M;
  const A = e2 * i - f * h, B = -(d * i - f * g), C = d * h - e2 * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-14)) return null;
  const D = -(b * i - c * h), E = a * i - c * g, Fm = -(a * h - b * g);
  const G = b * f - c * e2, H = -(a * f - c * d), I = a * e2 - b * d;
  return [[A / det, D / det, G / det], [B / det, E / det, H / det], [C / det, Fm / det, I / det]];
}
export function geometry(site, times, sigmaA = 3, sigmaH = 1) {
  const F = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const t of times) {
    const { h, A } = jac(t, site.lat, site.lon);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) F[i][j] += (h[i] * h[j]) / (sigmaH * sigmaH) + (A[i] * A[j]) / (sigmaA * sigmaA);
  }
  const C = inv3(F);
  if (!C) return { sigmaB: Infinity, rhoPhi: NaN, rhoLam: NaN, sigmaPosKm: Infinity };
  const cosφ = Math.max(Math.cos((site.lat * Math.PI) / 180), 1e-6);
  return {
    sigmaB: Math.sqrt(Math.max(0, C[2][2])),
    rhoPhi: C[0][2] / Math.sqrt(C[0][0] * C[2][2]),
    rhoLam: C[1][2] / Math.sqrt(C[1][1] * C[2][2]),
    sigmaPosKm: Math.sqrt(Math.max(0, (C[0][0] + C[1][1] * cosφ * cosφ) * KM * KM)),
  };
}

// ---------- القاعدة ----------
// m: { sigmaPosKm, sigmaB, rhoPhi, rhoLam, gain, failK, failN }
export function decide(m, t = THRESHOLDS) {
  // 1) الهندسة: هل الموقع قابل للرصد أصلاً؟
  if (!(m.sigmaPosKm <= t.sigmaPosKm)) {
    return { mode: "Unobservable", why: `σ_موقع ${fmt(m.sigmaPosKm)} كم > ${t.sigmaPosKm}` };
  }
  // 2) هل الانحياز قابل للتقدير ويستحق التعقيد؟
  const calReasons = [];
  if (!(m.sigmaB <= t.sigmaB)) calReasons.push(`σ_b ${fmt(m.sigmaB, 2)}° > ${t.sigmaB}°`);
  if (Math.abs(m.rhoPhi) >= t.rhoMax || Math.abs(m.rhoLam) >= t.rhoMax) calReasons.push(`|ρ| ≥ ${t.rhoMax}`);
  if (!(m.gain >= t.gain)) calReasons.push(`كسب ${fmt(m.gain * 100)}% < ${t.gain * 100}%`);
  if (calReasons.length) return { mode: "Position-only", why: calReasons.join("، ") };

  // 3) خطر الفشل: نستخدم الحد الأعلى لمجال الثقة، لا النسبة الخام
  const p = m.failK / m.failN;
  const u95 = wilsonUpper(m.failK, m.failN);
  const failTxt = `فشل ${(p * 100).toFixed(1)}% (حد أعلى 95%: ${(u95 * 100).toFixed(1)}%)`;
  if (u95 > t.failCeiling) return { mode: "Position-only", why: `${failTxt}: يتجاوز السقف ${t.failCeiling * 100}%` };
  if (u95 <= t.failTarget) return { mode: "Joint", why: `${failTxt}: ضمن الهدف ${t.failTarget * 100}%` };
  return { mode: "Conditional Joint", why: `${failTxt}: بين الهدف والسقف، تحتاج مراقبة وقت التشغيل` };
}

// ---------- مراقبة وقت التشغيل للمعايرة المشتركة ----------
// إذا ظهر أي علامة، تُوقَف المعايرة ويعود النظام إلى Position-only
export function runtimeMonitor(s, t = THRESHOLDS) {
  const alarms = [];
  if (s.zFlaggedFraction > 0.5) alarms.push("bias unstable (كاشف الميل)");
  if (s.bAtBound) alarms.push("b_A عند الحد ±20°");
  if (s.normResidualRms > 1.5) alarms.push(`مخلفات مرتفعة (${s.normResidualRms.toFixed(2)})`);
  if (s.sigmaPosKm > t.sigmaPosKm) alarms.push(`عدم يقين الموقع ${fmt(s.sigmaPosKm)} كم`);
  if (s.sigmaBInflated) alarms.push("تضخم σ_b");
  return alarms.length ? { action: "fallback: Position-only", alarms } : { action: "continue joint", alarms: [] };
}

const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "∞");

// ---------- الإعدادات الحالية ----------
// failK/failN: عدد حالات عدم التقارب من 1000 تجربة (prior-drift، بلا prior)
// gain: (P95_بدون − P95_مشترك)/P95_بدون (B3، 500 تجربة)
const CONFIGS = [
  { name: "الجزائر N=4 Δ120", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 120, 240, 360], failK: 55, failN: 1000, gain: (364 - 214) / 364 },
  { name: "الجزائر N=5 Δ60", lat: 36.75, lon: 3.04, day: Date.UTC(2026, 10, 10), off: [0, 60, 120, 180, 240], failK: 65, failN: 1000, gain: (587 - 294) / 587 },
  { name: "كامبالا N=3 Δ120", lat: 0.35, lon: 32.58, day: Date.UTC(2026, 2, 20), off: [0, 120, 240], failK: 1, failN: 1000, gain: (167 - 156) / 167 },
  { name: "[ضابط] ترومسو N=2 Δ60", lat: 69.65, lon: 18.96, day: Date.UTC(2026, 5, 21), off: [0, 60], failK: 135, failN: 1000, gain: (595 - 1012) / 595 },
];

const isMain = process.argv[1] && process.argv[1].endsWith("decision.mjs");
if (isMain) {
  const out = [
    "| الإعداد | σ_b (°) | ρ_bφ | ρ_bλ | σ_موقع (كم) | الكسب | القرار | السبب |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const c of CONFIGS) {
    const base = c.day + 7 * 3_600_000;
    const times = c.off.map((m) => base + m * 60_000);
    const g = geometry(c, times);
    const d = decide({ ...g, gain: c.gain, failK: c.failK, failN: c.failN });
    out.push(`| ${c.name} | ${fmt(g.sigmaB, 2)} | ${fmt(g.rhoPhi, 2)} | ${fmt(g.rhoLam, 2)} | ${fmt(g.sigmaPosKm)} | ${fmt(c.gain * 100)}% | **${d.mode}** | ${d.why} |`);
  }
  console.log(out.join("\n"));
  console.log("\nمراقبة وقت التشغيل — مثال (الجزائر N=4 بعد انحراف 3°/س):");
  console.log(runtimeMonitor({ zFlaggedFraction: 0.9, bAtBound: false, normResidualRms: 1.1, sigmaPosKm: 130, sigmaBInflated: false }));
}
