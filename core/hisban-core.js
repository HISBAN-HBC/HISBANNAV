// hisban-core.js
// الحسابات الهندسية الأساسية: الزوايا، المسافة، السمت، زاوية حُسبان، والإحداثيات.
// لا تعتمد على أي واجهة أو على الحسابات الفلكية، وتعمل في المتصفح و Node.js.

export const EARTH_RADIUS_KM = 6371.0088;
export const KAABA = { lat: 21.4225, lon: 39.8262 };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** تطبيع الزاوية إلى المدى [0, 360) */
export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

export function toRad(deg) {
  return deg * DEG;
}

export function toDeg(rad) {
  return rad * RAD;
}

/**
 * المسافة على سطح الكرة الأرضية بالكيلومتر (معادلة Haversine).
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * السمت الأولي من النقطة الأولى إلى الثانية، بالدرجات من الشمال باتجاه عقارب الساعة.
 */
export function initialBearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/**
 * النقطة التي تبعد مسافة معينة بسمت معين عن نقطة البداية (الملاحة التقديرية).
 */
export function destinationPoint(lat, lon, bearingDeg, distanceKm) {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * سمت القبلة من موقع معين.
 */
export function qiblaBearing(lat, lon) {
  return initialBearingDeg(lat, lon, KAABA.lat, KAABA.lon);
}

/**
 * زاوية حُسبان: 15° لكل ساعة منذ الشروق، ضمن دورة 360°.
 * @param {number} nowMs     الوقت الحالي بالميلي ثانية (Unix)
 * @param {number} sunriseMs وقت الشروق بالميلي ثانية (Unix)
 */
export function hisbanAngle(nowMs, sunriseMs) {
  const hours = (nowMs - sunriseMs) / 3_600_000;
  return normalizeDeg(hours * 15);
}

/**
 * تحويل زاوية على القرص إلى إحداثيات شاشة.
 * الصفر عند الأعلى، وتزداد باتجاه عقارب الساعة. y يزيد نحو الأسفل.
 */
export function angleToXY(angleDeg, radius, cx = 0, cy = 0) {
  const rad = toRad(angleDeg);
  return {
    x: cx + radius * Math.sin(rad),
    y: cy - radius * Math.cos(rad),
  };
}
