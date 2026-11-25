// hisban-engine.js
// الحسابات الفلكية التقريبية: ميل الشمس، معادلة الزمن، الشروق والغروب والزوال.
// وأيضاً الاستدلال العكسي: من أوقات الشمس إلى خط الطول، ومن طول النهار إلى خط العرض.
// كل قيمة تُعاد مع مصدرها (CALCULATED)، ولا تُعد أبداً رصداً مستقلاً.
// الدقة المتوقعة: نحو دقيقتين للأوقات في الظروف العادية.

import {
  normalizeDeg,
  toRad,
  toDeg,
} from "../core/hisban-core.js";

const H_HORIZON_DEG = -0.833; // ارتفاع الشمس الظاهري عند الشروق والغروب (الانكسار + قطر القرص)
const MS_PER_MIN = 60_000;

const julianFromMs = (ms) => ms / 86_400_000 + 2_440_587.5;

/** منتصف الليل UTC لليوم الذي يحوي اللحظة المعطاة */
function utcMidnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * ميل الشمس (بالدرجات) ومعادلة الزمن (بالدقائق) عند لحظة معينة.
 * خوارزمية NOAA المبسطة، ودقتها كافية لهذا الاستخدام.
 */
export function solarParams(ms) {
  const jd = julianFromMs(ms);
  const T = (jd - 2451545) / 36525;

  const L0 = normalizeDeg(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = normalizeDeg(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  const Mr = toRad(M);
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
    0.000289 * Math.sin(3 * Mr);

  const trueLong = L0 + C;
  const omega = toRad(125.04 - 1934.136 * T);
  const appLong = toRad(trueLong - 0.00569 - 0.00478 * Math.sin(omega));

  const meanObl =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obl = toRad(meanObl + 0.00256 * Math.cos(omega));

  const declRad = Math.asin(Math.sin(obl) * Math.sin(appLong));

  const y = Math.tan(obl / 2) ** 2;
  const L0r = toRad(L0);
  const eotRad =
    y * Math.sin(2 * L0r) -
    2 * e * Math.sin(Mr) +
    4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
    0.5 * y * y * Math.sin(4 * L0r) -
    1.25 * e * e * Math.sin(2 * Mr);

  return {
    declinationDeg: toDeg(declRad),
    eotMin: 4 * toDeg(eotRad),
  };
}

/**
 * الشروق والغروب والزوال لليوم (UTC) عند موقع معين.
 * @param {number} dateMs  أي لحظة من اليوم المطلوب (Unix ms)
 * @param {number} latDeg
 * @param {number} lonDeg  شرقاً موجب
 */
export function sunEvents(dateMs, latDeg, lonDeg) {
  const base = utcMidnight(dateMs);

  // التكرار لتثبيت معادلة الزمن عند لحظة الزوال نفسها
  let noonMin = 720 - 4 * lonDeg;
  let params = solarParams(base + noonMin * MS_PER_MIN);
  for (let i = 0; i < 3; i++) {
    noonMin = 720 - 4 * lonDeg - params.eotMin;
    params = solarParams(base + noonMin * MS_PER_MIN);
  }

  const φ = toRad(latDeg);
  const δ = toRad(params.declinationDeg);
  const cosH0 =
    (Math.sin(toRad(H_HORIZON_DEG)) - Math.sin(φ) * Math.sin(δ)) /
    (Math.cos(φ) * Math.cos(δ));

  const common = {
    source: "CALCULATED",
    declinationDeg: params.declinationDeg,
    eotMin: params.eotMin,
    solarNoonUtc: base + noonMin * MS_PER_MIN,
  };

  if (cosH0 > 1) {
    return { ...common, polar: "night", sunriseUtc: null, sunsetUtc: null, dayLengthMin: 0 };
  }
  if (cosH0 < -1) {
    return { ...common, polar: "day", sunriseUtc: null, sunsetUtc: null, dayLengthMin: 1440 };
  }

  const H0 = toDeg(Math.acos(cosH0)); // بالدرجات، والشمس تقطع 4 دقائق لكل درجة
  return {
    ...common,
    polar: null,
    sunriseUtc: base + (noonMin - 4 * H0) * MS_PER_MIN,
    sunsetUtc: base + (noonMin + 4 * H0) * MS_PER_MIN,
    dayLengthMin: 8 * H0,
  };
}

/**
 * ارتفاع الشمس وسمتها عند لحظة وموقع معينين.
 * السمت بالدرجات من الشمال باتجاه عقارب الساعة. بدون تصحيح الانكسار الجوي.
 * @returns {{altitudeDeg:number, azimuthDeg:number, declinationDeg:number, source:string}}
 */
export function solarPosition(ms, latDeg, lonDeg) {
  const params = solarParams(ms);
  return solarPositionFromParams(params, utcMinutesOf(ms), latDeg, lonDeg);
}

/** دقائق اليوم UTC للحظة معينة */
export function utcMinutesOf(ms) {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
}

/**
 * نفس solarPosition لكن بمعاملات الوقت مُحسوبة مسبقاً (ميل الشمس ومعادلة الزمن).
 * مفيد عند تقييم آلاف المواقع لنفس اللحظة.
 */
export function solarPositionFromParams(params, utcMin, latDeg, lonDeg) {
  const { declinationDeg, eotMin } = params;
  const tst = utcMin + 4 * lonDeg + eotMin;
  const H = toRad(((tst / 4 - 180 + 540) % 360) - 180);

  const φ = toRad(latDeg);
  const δ = toRad(declinationDeg);

  const cosZ = Math.min(1, Math.max(-1, Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H)));
  const altitudeDeg = 90 - toDeg(Math.acos(cosZ));
  const azimuthDeg = normalizeDeg(
    toDeg(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ))) + 180
  );

  // الأسماء العامة وفق المواصفة؛ الاسمان القصيران يبقيان كـ aliases مؤقتة للتوافق
  return {
    solarAltitudeDeg: altitudeDeg,
    solarAzimuthDeg: azimuthDeg,
    altitudeDeg,
    azimuthDeg,
    declinationDeg,
    source: "CALCULATED",
  };
}

/**
 * خط الطول من لحظة الزوال المرصودة أو المحسوبة (UTC).
 * λ = (720 − زمن الزوال UTC بالدقائق − EoT) / 4
 */
export function longitudeFromSolarNoon(noonUtcMs, dateMs) {
  const base = utcMidnight(dateMs);
  const noonMin = (noonUtcMs - base) / MS_PER_MIN;
  let eot = solarParams(noonUtcMs).eotMin;
  let lon = (720 - eot - noonMin) / 4;
  for (let i = 0; i < 3; i++) {
    eot = solarParams(base + noonMin * MS_PER_MIN).eotMin;
    lon = (720 - eot - noonMin) / 4;
  }
  return ((lon + 540) % 360) - 180;
}

/**
 * مرشحات خط العرض من طول النهار المرصود (بالدقائق) وتاريخ اليوم.
 * ترجع قيمتين محتملتين عادة (شمالي وجنوبي)، ويُحسم الاختيار بموقع تقديري سابق.
 * تكون غير دقيقة قرب الاعتدالين لأن ميل الشمس يقترب من الصفر.
 */
export function latitudeCandidates(dateMs, dayLengthMin) {
  const H0 = dayLengthMin / 8; // بالدرجات
  if (!(H0 > 0 && H0 < 180)) return [];

  const noonUtc = utcMidnight(dateMs) + 720 * MS_PER_MIN;
  const δ = toRad(solarParams(noonUtc).declinationDeg);
  const A = Math.sin(δ);
  const B = Math.cos(δ) * Math.cos(toRad(H0));
  const C = Math.sin(toRad(H_HORIZON_DEG));
  const R = Math.hypot(A, B);
  if (R < 1e-9) return [];

  const ratio = C / R;
  if (Math.abs(ratio) > 1) return [];

  const γ = Math.atan2(B, A);
  const a1 = Math.asin(ratio);
  const roots = [a1 - γ, Math.PI - a1 - γ];

  const out = [];
  for (let r of roots) {
    // تطبيع إلى (−π, π]
    r = Math.atan2(Math.sin(r), Math.cos(r));
    const deg = toDeg(r);
    if (Math.abs(deg) <= 90) out.push(deg);
  }
  return out.sort((x, y) => x - y);
}
