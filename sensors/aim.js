// aim.js — تجميع نافذة تصويب واحدة (عدة عينات وضعية) إلى قياس شمس واحد.
// ما يُقبل: نافذة كافية العينات، والهاتف ثابت خلالها (سرعة زاوية أقل من الحد).
// الارتفاع والسمت: متوسط متجهات التصويب الوحدوية، ثم تحويله.
// عدم اليقين: انتشار العينات حول المتوسط، مع أرضية صريحة aimFloorDeg (مؤقتة).
// ملاحظة: خطأ التصويب البشري غير مُقاس هنا؛ الأرضية تمثّله تقريبياً حتى تُعاير.
import { boresightEnu, enuToAltAz, quatNormalize } from "./attitude.js";

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
};

function angleBetweenDeg(a, b) {
  const qa = quatNormalize(a), qb = quatNormalize(b);
  const d = Math.min(1, Math.abs(qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

/**
 * @param {{timestampUtc:string, quaternion:{w,x,y,z}}[]} samples بالترتيب الزمني
 * @param {object} cfg الإعدادات الخوارزمية (aimMinSamples, aimMaxAngularSpeedDegPerS, aimFloorDeg)
 */
export function aggregateAim(samples, cfg, { offsetQuaternion, axis } = {}) {
  const n = samples.length;
  if (!(cfg.aimFloorDeg > 0)) throw new Error("aim: aimFloorDeg must be > 0");
  if (n < cfg.aimMinSamples) return { ok: false, reason: "TOO_FEW_SAMPLES", sampleCount: n };

  let maxSpeed = 0;
  for (let i = 1; i < n; i++) {
    const dt = (Date.parse(samples[i].timestampUtc) - Date.parse(samples[i - 1].timestampUtc)) / 1000;
    if (!(dt > 0)) return { ok: false, reason: "NON_MONOTONIC_TIME", sampleCount: n };
    maxSpeed = Math.max(maxSpeed, angleBetweenDeg(samples[i - 1].quaternion, samples[i].quaternion) / dt);
  }
  if (maxSpeed > cfg.aimMaxAngularSpeedDegPerS) {
    return { ok: false, reason: "PHONE_MOVING", message: "ثبّت الهاتف وأعد القياس.", sampleCount: n, maxAngularSpeedDegPerS: maxSpeed };
  }

  const opts = { offsetQuaternion, axis };
  const vecs = samples.map((s) => boresightEnu(s.quaternion, opts));
  const sum = [0, 0, 0];
  for (const v of vecs) for (let k = 0; k < 3; k++) sum[k] += v[k];
  const norm = Math.hypot(...sum);
  const mean = enuToAltAz(sum.map((c) => c / norm));
  const per = vecs.map(enuToAltAz);

  const sdAlt = sd(per.map((p) => p.altitudeDeg));
  const sdAz = sd(per.map((p) => wrap180(p.azimuthDeg - mean.azimuthDeg)));
  return {
    ok: true,
    solarAltitudeDeg: mean.altitudeDeg,
    solarAzimuthDeg: mean.azimuthDeg,
    sigmaAltitudeDeg: Math.sqrt(sdAlt * sdAlt + cfg.aimFloorDeg * cfg.aimFloorDeg),
    sigmaAzimuthDeg: Math.sqrt(sdAz * sdAz + cfg.aimFloorDeg * cfg.aimFloorDeg),
    sampleCount: n,
    maxAngularSpeedDegPerS: maxSpeed,
  };
}
