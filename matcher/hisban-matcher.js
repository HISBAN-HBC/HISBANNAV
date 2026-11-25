// hisban-matcher.js
// مطابقة القياسات المستقلة (ارتفاع الشمس وسمتها) مع المواقع المرشحة.
// ترجيح بخطأ احتمالي (chi-square)، ثم تحسين هرمي حول أفضل المرشحين.
// الشروق والغروب المشتقان لا يدخلان هنا كأدلة مستقلة.

import { solarParams, solarPositionFromParams, utcMinutesOf } from "../engine/hisban-engine.js";

/** الفرق الدائري للزاوية في المدى [-180, 180) */
export function wrapDeg(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/**
 * يحضّر القياسات: يحسب معاملات الشمس لكل وقت مرة واحدة.
 * @param {{utcMs:number, altitudeDeg:number, azimuthDeg:number, sigmaAlt?:number, sigmaAz?:number}[]} measurements
 */
export function prepare(measurements) {
  return measurements.map((m) => {
    if (!(Number.isFinite(m.sigmaAlt) && m.sigmaAlt > 0) || !(Number.isFinite(m.sigmaAz) && m.sigmaAz > 0)) {
      throw new Error("matcher: sigmaAlt and sigmaAz (degrees, > 0) are required on every measurement");
    }
    return prepareOne(m);
  });
}

function prepareOne(m) {
  return {
    alt: m.altitudeDeg,
    az: m.azimuthDeg,
    sAlt: m.sigmaAlt,
    sAz: m.sigmaAz,
    params: solarParams(m.utcMs),
    utcMin: utcMinutesOf(m.utcMs),
  };
}

export function chi2Prepared(lat, lon, P) {
  let chi2 = 0;
  for (const m of P) {
    const p = solarPositionFromParams(m.params, m.utcMin, lat, lon);
    const dh = m.alt - p.altitudeDeg;
    const dA = wrapDeg(m.az - p.azimuthDeg);
    chi2 += (dh / m.sAlt) ** 2 + (dA / m.sAz) ** 2;
  }
  return chi2;
}

/** χ² لموقع واحد */
export function chiSquare(lat, lon, measurements) {
  return chi2Prepared(lat, lon, prepare(measurements));
}

/**
 * ترتيب الخلايا حسب الاحتمال النسبي: L ∝ exp(−χ²/2).
 * يُعاد أفضل k خلايا مع احتمال مطبع على كل الخلايا المعطاة.
 */
export function rankCells(cells, measurements, k = 10) {
  const P = prepare(measurements);
  const scored = cells.map((c) => ({ lat: c.lat, lon: c.lon, chi2: chi2Prepared(c.lat, c.lon, P) }));
  const minChi = Math.min(...scored.map((s) => s.chi2));
  let total = 0;
  for (const s of scored) {
    s.weight = Math.exp(-(s.chi2 - minChi) / 2);
    total += s.weight;
  }
  for (const s of scored) s.prob = s.weight / total;
  scored.sort((a, b) => a.chi2 - b.chi2);
  return scored.slice(0, k);
}

/**
 * تحسين هرمي: من خلايا أولية إلى تقسيم أدق تدريجياً، مع الإبقاء على أفضل keep فرضية في كل مستوى.
 * كل مستوى يفحص 5 × 5 نقاط حول كل مرشح، ثم يُنصّف الحجم.
 * onLevel(step, cands) اختياري، يُستدعى بعد كل مستوى (لقياس بقاء الحل الحقيقي).
 */
export function refine(
  measurements,
  startCells,
  { startStep = 5, minStep = 0.05, keep = 20, onLevel = null } = {}
) {
  const P = prepare(measurements);
  let cands = startCells.map((c) => ({ lat: c.lat, lon: c.lon }));
  let step = startStep;

  while (step > minStep) {
    const half = step / 2;
    const offsets = [-2, -1, 0, 1, 2].map((n) => n * half);
    const seen = new Map();
    for (const c of cands) {
      for (const di of offsets) {
        for (const dj of offsets) {
          const lat = Math.min(90, Math.max(-90, c.lat + di));
          const lon = wrapDeg(c.lon + dj);
          const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
          if (!seen.has(key)) seen.set(key, { lat, lon, chi2: chi2Prepared(lat, lon, P) });
        }
      }
    }
    cands = [...seen.values()].sort((a, b) => a.chi2 - b.chi2).slice(0, keep);
    step = half;
    if (onLevel) onLevel(step, cands);
  }
  return cands;
}
