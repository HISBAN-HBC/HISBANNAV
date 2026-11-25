// geometry.js — قابلية الرصد: مصفوفة فيشر، عدم يقين الموقع بالكيلومتر، وحالة الملاحة.
// تُقرأ الحدود من options صراحة، والقيم الافتراضية مؤقتة ومشتقة من المحاكاة (انظر LIMITS.md).

import { jacobian, requireSigmas } from "../estimator/index.js";
import { inv3 } from "../estimator/linalg.js";

export const KM_PER_DEG = 111.195;
/** حدود مؤقتة مشتقة من المحاكاة الحالية؛ تُمرَّر صراحة لتغييرها. */
export const DEFAULT_LIMITS = Object.freeze({ maxSigmaPosKm: 300, maxSigmaBiasDeg: 2, maxAbsRho: 0.9 });

/** F = JᵀJ للمعاملات (φ, λ, b) عند الحل p. */
export function fisherMatrix(p, meas, priorSigmaB = null) {
  requireSigmas(meas);
  const J = jacobian(p, meas, priorSigmaB);
  const F = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const row of J) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) F[a][b] += row[a] * row[b];
  return F;
}

/** تحويل تغاير الموقع (درجات) إلى كيلومتر، مع القيم الذاتية. */
export function positionCovarianceKm(cov2x2, latDeg) {
  const sLat = KM_PER_DEG;
  const sLon = KM_PER_DEG * Math.cos((latDeg * Math.PI) / 180);
  const c = [
    [cov2x2[0][0] * sLat * sLat, cov2x2[0][1] * sLat * sLon],
    [cov2x2[1][0] * sLat * sLon, cov2x2[1][1] * sLon * sLon],
  ];
  const eig = eigSym2(c);
  return {
    cov: c,
    sigmaPosKm: Math.sqrt(Math.max(0, c[0][0] + c[1][1])),
    majorKm: Math.sqrt(Math.max(0, eig.max)),
    minorKm: Math.sqrt(Math.max(0, eig.min)),
    rho: c[0][1] / Math.sqrt(Math.max(1e-300, c[0][0] * c[1][1])),
  };
}

/** القيم الذاتية لمصفوفة متماثلة 2×2. */
export function eigSym2(M) {
  const a = M[0][0], b = M[0][1], d = M[1][1];
  const tr = a + d, det = a * d - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return { max: tr / 2 + disc, min: tr / 2 - disc };
}

/**
 * تقييم قابلية الرصد عند الحل p.
 * يعيد { mode, sigmaPosKm, majorKm, minorKm, rho, sigmaBiasDeg, kappaPos, cov3 }.
 * mode ∈ OBSERVABLE | POSITION_ONLY | UNOBSERVABLE
 */
export function assessObservability(p, meas, { limits = DEFAULT_LIMITS, priorSigmaB = null } = {}) {
  const F = fisherMatrix(p, meas, priorSigmaB);
  const C3 = inv3(F);
  if (!C3) return { mode: "UNOBSERVABLE", reason: "singular Fisher matrix" };
  const pos = positionCovarianceKm([[C3[0][0], C3[0][1]], [C3[1][0], C3[1][1]]], p[0]);
  const sigmaBiasDeg = Math.sqrt(Math.max(0, C3[2][2]));
  const eigF = eigSym2([[F[0][0], F[0][1]], [F[1][0], F[1][1]]]);
  const kappaPos = eigF.min > 0 ? eigF.max / eigF.min : Infinity;

  let mode = "OBSERVABLE";
  let reason = "bias and position separable";
  if (!Number.isFinite(pos.sigmaPosKm) || pos.sigmaPosKm > limits.maxSigmaPosKm) {
    mode = "UNOBSERVABLE";
    reason = "position uncertainty too large";
  } else if (sigmaBiasDeg > limits.maxSigmaBiasDeg || Math.abs(pos.rho) > limits.maxAbsRho) {
    mode = "POSITION_ONLY";
    reason = "bias not separable from position";
  }
  return {
    mode, reason,
    sigmaPosKm: pos.sigmaPosKm, majorKm: pos.majorKm, minorKm: pos.minorKm, rho: pos.rho,
    sigmaBiasDeg, kappaPos, cov3: C3,
  };
}
