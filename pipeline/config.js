// config.js — المفردات والإعدادات الخوارزمية. هذا المكان الوحيد الذي تُعرَّف فيه القيم؛
// research/ يعيد تصديرها ولا يعرّفها من جديد.

/**
 * الإعدادات الفعلية؛ تُسجَّل مع كل جلسة لتكون النتائج قابلة لإعادة الإنتاج.
 * مفاتيح observability* مؤقتة (provisional): مشتقة من المحاكاة الحالية، وليست نهائية.
 */
export const DEFAULT_ALGORITHM_CONFIG = Object.freeze({
  // كشف الانحراف (مُعتمد للـMVP)
  driftDThreshold: 3,
  suspectDThreshold: 2,
  // كشف الشواذ: تحذير فقط، بلا حذف تلقائي
  outlierGainThreshold: 10,
  outlierStudentizedThreshold: 3,
  outlierDropOneDThreshold: 2,
  // المُقدِّر
  biasBoundDeg: 20,
  localWindowDeg: 10,
  startsK: 10,
  refinementStartDeg: 5,
  refinementTargetDeg: 0.05,
  gridSizeDeg: 5,
  // قياس التصويب بالكاميرا الخلفية: مؤقتة (provisional)
  aimMinSamples: 10,
  aimMaxAngularSpeedDegPerS: 5,
  aimFloorDeg: 1,
  // قابلية الرصد: مؤقتة (provisional)، انظر montecarlo/LIMITS.md
  observabilityPositionSigmaKm: 300,
  observabilityBiasSigmaDeg: 2,
  observabilityCorrelationLimit: 0.9,
});

export const NAVIGATION_STATES = Object.freeze(["OBSERVABLE", "POSITION_ONLY", "UNOBSERVABLE"]);
/** INSUFFICIENT_DATA: أقل من 3 قياسات، فلا يمكن حساب الانحراف أو الشواذ. */
export const SENSOR_STATES = Object.freeze(["STABLE", "DRIFT", "OUTLIER_SUSPECT", "SUSPECT", "INSUFFICIENT_DATA"]);
export const SENSOR_QUALITY = Object.freeze(["GOOD", "FAIR", "POOR", "UNKNOWN"]);

/** نتيجة التشغيل: OK، أو REJECTED بأخطاء صريحة، أو WAITING إن كان القياس أقل من اثنين. */
export const RUN_STATUS = Object.freeze({ OK: "OK", REJECTED: "REJECTED", WAITING: "WAITING" });
