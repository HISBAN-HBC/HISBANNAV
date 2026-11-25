// attitude.js — من وضعية الهاتف (quaternion) إلى ارتفاع وسمت محور الكاميرا الخلفية.
// الاتفاقيات (تُتحقق منها في شاشة المعايرة قبل أول جلسة):
//   q = (w,x,y,z) يحوّل متجهات إطار الجهاز إلى ENU (شرق، شمال، أعلى).
//   إطار الجهاز: x يمين الشاشة، y أعلى الشاشة، z خارج الشاشة نحو المستخدم.
//   الكاميرا الخلفية تنظر في اتجاه -z.
// الارتفاع يأتي من مركبة U، والسمت من atan2(E, N)، ولا يحتاج الـroll افتراضاً خاصاً.

export const IDENTITY_QUATERNION = Object.freeze({ w: 1, x: 0, y: 0, z: 0 });
export const DEFAULT_CAMERA_AXIS = Object.freeze([0, 0, -1]);
const DEG = 180 / Math.PI;

export function quatNormalize(q) {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  if (!(n > 0)) throw new Error("attitude: zero quaternion");
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/** ضرب هاملتون a·b (تطبيق b أولاً ثم a). */
export function quatMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatToMatrix(q0) {
  const { w, x, y, z } = quatNormalize(q0);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

const applyMatrix = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);

/**
 * متجه محور الكاميرا في ENU بعد تطبيق معايرة الإزاحة (offsetQuaternion) ووضعية الهاتف.
 * يعيد متجهاً وحدوياً [E, N, U].
 */
export function boresightEnu(quaternion, { offsetQuaternion = IDENTITY_QUATERNION, axis = DEFAULT_CAMERA_AXIS } = {}) {
  const inDevice = applyMatrix(quatToMatrix(offsetQuaternion), axis);
  const e = applyMatrix(quatToMatrix(quaternion), inDevice);
  const n = Math.hypot(e[0], e[1], e[2]);
  return [e[0] / n, e[1] / n, e[2] / n];
}

/** من متجه ENU إلى { altitudeDeg, azimuthDeg } (السمت من الشمال نحو الشرق، في [0, 360)). */
export function enuToAltAz([E, N, U]) {
  const azimuthDeg = (((Math.atan2(E, N) * DEG) % 360) + 360) % 360;
  const altitudeDeg = Math.atan2(U, Math.hypot(E, N)) * DEG;
  return { altitudeDeg, azimuthDeg };
}
