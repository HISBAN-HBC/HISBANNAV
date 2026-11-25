// view-model.js — تحويل النتيجة الموحدة إلى نماذج عرض. دالة نقية، بلا DOM، قابلة للاختبار في Node.
// قاعدة: لا درجة ثقة واحدة. الملاحة والحساس تُعرضان منفصلتين دائماً.
// قاعدة: لا يُعرض موقع حين لا تدعمه قابلية الرصد.

export const NAV_LABEL = Object.freeze({
  OBSERVABLE: "قابل للرصد",
  POSITION_ONLY: "موقع فقط",
  UNOBSERVABLE: "غير قابل للرصد",
});
export const SENSOR_LABEL = Object.freeze({
  STABLE: "مستقرة",
  DRIFT: "انحراف",
  OUTLIER_SUSPECT: "قياس مشكوك فيه",
  SUSPECT: "مشكوك فيها",
  INSUFFICIENT_DATA: "بيانات غير كافية",
});
export const RUN_LABEL = Object.freeze({ OK: "نتيجة", WAITING: "بانتظار قياس إضافي", REJECTED: "مرفوض" });

const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : "غير متاح");

/** شريط الحالة الدائم: حالتان منفصلتان، بلا دمج. */
export function statusBar(result) {
  if (!result || result.status !== "OK") {
    return {
      navigation: { label: "الملاحة", value: null, text: result ? RUN_LABEL[result.status] : "لا توجد نتيجة" },
      sensor: { label: "الحساس", value: null, text: result ? RUN_LABEL[result.status] : "لا توجد نتيجة" },
    };
  }
  return {
    navigation: { label: "الملاحة", value: result.navigationState, text: NAV_LABEL[result.navigationState] },
    sensor: { label: "الحساس", value: result.sensorState, text: SENSOR_LABEL[result.sensorState] },
  };
}

/** شاشة الملاحة: الموقع يظهر فقط حين تسمح قابلية الرصد بذلك. */
export function navigationScreen(result) {
  if (!result || result.status !== "OK") {
    return { showPosition: false, message: result?.status === "REJECTED" ? "القياسات أو الإعدادات مرفوضة. راجع شاشة التشخيص." : "أضف قياسات لبدء التقدير.", recommendation: result?.nextMeasurementRecommendation?.text ?? null };
  }
  const base = { recommendation: result.nextMeasurementRecommendation.text, navigationLabel: NAV_LABEL[result.navigationState] };
  if (result.navigationState === "UNOBSERVABLE") {
    return { ...base, showPosition: false, message: "الهندسة الحالية لا توفر موقعاً موثوقاً. انتظر قياساً لاحقاً." };
  }
  const position = {
    latitude: fmt(result.estimate.latitudeDeg, 4),
    longitude: fmt(result.estimate.longitudeDeg, 4),
    uncertaintyKm: fmt(result.uncertainty.positionKm, 1),
    uncertaintyNote: "عدم اليقين النموذجي فقط؛ لا يشمل الانكسار الجوي ولا خطأ الأفق ولا سوء تحديد σ.",
  };
  if (result.navigationState === "POSITION_ONLY") {
    return { ...base, showPosition: true, position, message: "الموقع مقدَّر، لكن الانحراف غير منفصل عنه؛ الموقع تقريبي." };
  }
  return { ...base, showPosition: true, position, message: null };
}

/** شاشة التشخيص: أرقام الانحراف والشواذ والتحذيرات، دون حكم جديد. */
export function diagnosticsScreen(result) {
  if (!result || result.status !== "OK") return { available: false, message: "لا تشخيص بدون نتيجة صالحة." };
  const d = result.diagnostics;
  return {
    available: true,
    driftD: d.driftD === null ? "غير متاح (أقل من 3 قياسات)" : fmt(d.driftD, 2),
    chiSquare: fmt(d.chiSquare, 3),
    converged: d.converged ? "نعم" : "لا",
    navigationReason: d.navigationReason,
    outliers: d.outliers.map((o) => ({ index: o.index + 1, O: fmt(o.O, 2), t: fmt(o.t, 2), Dminus: fmt(o.Dminus, 2) })),
    warnings: d.warnings.map((w) => w.message),
    candidates: result.candidates.slice(0, 5).map((c, i) => ({
      rank: i + 1, latitude: fmt(c.latitudeDeg, 4), longitude: fmt(c.longitudeDeg, 4), chiSquare: fmt(c.chiSquare, 2),
    })),
  };
}

/** شاشة جلسة القياس: تطوّر الحالتين مع كل قياس جديد (timeline). */
export function sessionScreen(timeline) {
  return {
    rows: timeline.map((t) => ({
      count: t.count,
      timestampUtc: t.timestampUtc,
      status: RUN_LABEL[t.result.status],
      navigation: t.result.status === "OK" ? NAV_LABEL[t.result.navigationState] : "—",
      sensor: t.result.status === "OK" ? SENSOR_LABEL[t.result.sensorState] : "—",
    })),
  };
}

/** شاشة البحث: ما الذي سُجِّل، وأي الإعدادات مؤقتة. */
export function researchScreen(session, { replay = null } = {}) {
  const PROVISIONAL = new Set(["observabilityPositionSigmaKm", "observabilityBiasSigmaDeg", "observabilityCorrelationLimit"]);
  return {
    sessionId: session.sessionId,
    schemaVersion: session.schemaVersion,
    measurementCount: session.measurements.length,
    config: Object.entries(session.algorithmConfig).map(([key, value]) => ({
      key, value, provisional: PROVISIONAL.has(key),
    })),
    replay: replay === null
      ? "لم تُعَد الجلسة بعد"
      : replay.reproducible === null ? `لا يمكن الفحص: ${replay.reason}`
      : replay.reproducible ? "قابلة لإعادة الإنتاج" : `غير قابلة لإعادة الإنتاج: ${replay.diffs.join("، ")}`,
  };
}
