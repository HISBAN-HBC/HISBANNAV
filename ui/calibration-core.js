// calibration-core.js — منطق معايرة اتجاه الكاميرا. دالة نقية بلا DOM.
// لا تعدّل خوارزمية HISBAN؛ تنتج فقط إزاحة الجهاز → الكاميرا (offsetQuaternion) والتحقق من اتفاقية الإطار.
//
// الوضعان:
//   nadir:  الكاميرا الخلفية تنظر إلى الأسفل (الشاشة للأعلى، مسطحاً). الارتفاع المتوقع −90°.
//   zenith: الكاميرا تنظر إلى الأعلى (الشاشة للأسفل). الارتفاع المتوقع +90°.
// من وضع nadir تُحسب الإزاحة. من وضع zenith يُتحقق الاتساق بعد تطبيقها.
// تحذير: دقة وضع nadir تعتمد على وضع الهاتف بالفعل؛ الانحراف عن 90° في الوضع نفسه يدخل في الإزاحة.
import { aggregateAim, quatToMatrix, quatNormalize, boresightEnu, IDENTITY_QUATERNION, DEFAULT_CAMERA_AXIS } from "../sensors/index.js";

export const NADIR_ENU = Object.freeze([0, 0, -1]);
export const ZENITH_ENU = Object.freeze([0, 0, 1]);
export const POSE_TOLERANCE_DEG = 20;
export const RESIDUAL_LIMIT_DEG = 10;
export const OFFSET_WARN_DEG = 15;

const DEG = 180 / Math.PI;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return a.map((c) => c / n); };
const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * DEG;

/** R(q)^T · v: التحويل من ENU إلى إطار الجهاز. */
function enuToDevice(q, v) {
  const M = quatToMatrix(q);
  return [0, 1, 2].map((i) => M[0][i] * v[0] + M[1][i] * v[1] + M[2][i] * v[2]);
}

/** أقصر دوران يحوّل الوحدة u إلى الوحدة v، كرباعي {w,x,y,z}. */
export function shortestArc(u, v) {
  const a = unit(u), b = unit(v);
  const d = dot(a, b);
  if (d < -1 + 1e-12) {
    // دوران 180° حول محور عمودي على a
    const axis = Math.abs(a[0]) < 0.9 ? unit(cross(a, [1, 0, 0])) : unit(cross(a, [0, 1, 0]));
    return { w: 0, x: axis[0], y: axis[1], z: axis[2] };
  }
  const c = cross(a, b);
  return quatNormalize({ w: 1 + d, x: c[0], y: c[1], z: c[2] });
}

/** زاوية دوران الرباعي (0..180°). */
export function rotationAngleDeg(q) {
  return 2 * Math.acos(Math.min(1, Math.abs(quatNormalize(q).w))) * DEG;
}

/**
 * يصنّف الارتفاع المقاس لوضع معروف. يكشف أخطاء الاتفاقية 90° و180°.
 * @returns {{verdict, message?}}
 */
export function classifyPose(altDeg, expectedDeg) {
  if (Math.abs(altDeg - expectedDeg) <= POSE_TOLERANCE_DEG) return { verdict: "OK" };
  if (Math.abs(altDeg) <= POSE_TOLERANCE_DEG) {
    return { verdict: "AXIS_90_ERROR", message: "الإطار يعيد الكاميرا أفقية في وضع يجب أن تنظر فيه عمودياً. اتفاقية المحور غير متوافقة." };
  }
  if (Math.abs(altDeg + expectedDeg) <= POSE_TOLERANCE_DEG) {
    return { verdict: "AXIS_180_ERROR", message: "الإطار معكوس: الكاميرا تنظر في الاتجاه المعاكس. اتفاقية المحور غير متوافقة." };
  }
  return { verdict: "REPOSITION", message: "الوضع غير واضح. ضع الهاتف في الوضع المطلوب بثبات وأعد القياس." };
}

/**
 * يحسب الإزاحة من وضع nadir ويتحقق من zenith.
 * @param {{nadirSamples, zenithSamples, cfg, device}} input
 * @returns {{ok, stage?, reason?, message?, record?, warnings?}}
 */
export function calibrate({ nadirSamples, zenithSamples, cfg, device = {} }) {
  const nadirAim = aggregateAim(nadirSamples, cfg);
  if (!nadirAim.ok) return { ok: false, stage: "NADIR", reason: nadirAim.reason, message: nadirAim.message ?? "تعذّر قياس الوضع الأول. أعد المحاولة." };
  const zenithAim = aggregateAim(zenithSamples, cfg);
  if (!zenithAim.ok) return { ok: false, stage: "ZENITH", reason: zenithAim.reason, message: zenithAim.message ?? "تعذّر قياس الوضع الثاني. أعد المحاولة." };

  const nadirCheck = classifyPose(nadirAim.solarAltitudeDeg, -90);
  if (nadirCheck.verdict !== "OK") return { ok: false, stage: "NADIR", reason: nadirCheck.verdict, message: nadirCheck.message };
  const zenithCheck = classifyPose(zenithAim.solarAltitudeDeg, 90);
  if (zenithCheck.verdict !== "OK") return { ok: false, stage: "ZENITH", reason: zenithCheck.verdict, message: zenithCheck.message };

  // الإزاحة: محور الكاميرا في إطار الجهاز (لحظة nadir) يجب أن يُنقل إلى −z… ونستخرج الدوران من المحور الافتراضي إلى محور الجهاز الفعلي.
  const qN = nadirSamples[Math.floor(nadirSamples.length / 2)].quaternion;
  const dInDevice = enuToDevice(qN, NADIR_ENU);
  const offset = shortestArc(DEFAULT_CAMERA_AXIS, dInDevice);

  // الاتساق: بعد الإزاحة، وضع zenith يجب أن ينظر إلى السمت.
  const qZ = zenithSamples[Math.floor(zenithSamples.length / 2)].quaternion;
  const residualDeg = angleDeg(boresightEnu(qZ, { offsetQuaternion: offset }), ZENITH_ENU);
  if (residualDeg > RESIDUAL_LIMIT_DEG) {
    return { ok: false, stage: "ZENITH", reason: "INCONSISTENT", message: "الوضعان لا يتفقان بعد حساب الإزاحة. أعد القياس بثبات أكبر." };
  }

  const offsetDeg = rotationAngleDeg(offset);
  const warnings = [];
  if (offsetDeg > OFFSET_WARN_DEG) {
    warnings.push(`الإزاحة ${offsetDeg.toFixed(1)}° كبيرة. تحقق من وضع الهاتف عند القياس وأعد المعايرة.`);
  }

  return {
    ok: true,
    warnings,
    record: {
      recordVersion: 1,
      calibratedAtUtc: device.calibratedAtUtc ?? new Date().toISOString(),
      device: { userAgent: device.userAgent ?? null, platform: device.platform ?? null },
      offsetQuaternion: offset,
      cameraBoresightOffsetDeg: offsetDeg,
      nadirAltDeg: nadirAim.solarAltitudeDeg,
      zenithAltDeg: zenithAim.solarAltitudeDeg,
      residualDeg,
      identity: IDENTITY_QUATERNION,
    },
  };
}
