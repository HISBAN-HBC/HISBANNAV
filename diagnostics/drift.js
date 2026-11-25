// drift.js — مؤشر الانحراف D = |ميل المخلفات| / σ_ميل، بأوزان 1/σ² لكل قياس.

import { solarPosition } from "../engine/hisban-engine.js";
import { wrapDeg } from "../matcher/hisban-matcher.js";
import { requireSigmas } from "../estimator/index.js";

/** بقايا السمت بعد الحل p = [φ, λ, b]. */
export function azimuthResiduals(p, meas) {
  return meas.map((m) => wrapDeg(m.azimuthDeg - solarPosition(m.utcMs, p[0], p[1]).azimuthDeg - p[2]));
}

/** D لميل البقايا مع الزمن (ساعات من أول قياس). */
export function driftD(p, meas) {
  requireSigmas(meas);
  const t0 = meas[0].utcMs;
  const t = meas.map((m) => (m.utcMs - t0) / 3_600_000);
  const r = azimuthResiduals(p, meas);
  const w = meas.map((m) => 1 / (m.sigmaAz * m.sigmaAz));
  const W = w.reduce((s, x) => s + x, 0);
  const tb = w.reduce((s, x, i) => s + x * t[i], 0) / W;
  const rb = w.reduce((s, x, i) => s + x * r[i], 0) / W;
  const Stt = w.reduce((s, x, i) => s + x * (t[i] - tb) ** 2, 0);
  if (!(Stt > 0)) return { D: 0, slopeDegPerHour: 0, sigmaSlope: Infinity };
  const slope = w.reduce((s, x, i) => s + x * (t[i] - tb) * (r[i] - rb), 0) / Stt;
  const sigmaSlope = 1 / Math.sqrt(Stt);
  return { D: Math.abs(slope) / sigmaSlope, slopeDegPerHour: slope, sigmaSlope };
}
