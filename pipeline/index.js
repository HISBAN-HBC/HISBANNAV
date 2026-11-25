// pipeline/index.js — القلب التشغيلي:
//   Measurement → Validation → Matcher → Refinement → Estimator → Observability → Diagnostics → NavigationResult
// الواجهة لا تعرف شيئاً عن LM أو Fisher أو المطابِق داخلياً؛ تستلم النتيجة الموحدة فقط.

import { DEFAULT_ALGORITHM_CONFIG, RUN_STATUS } from "./config.js";
import { validateMeasurement, validateAlgorithmConfig } from "./validate.js";
import { toInternal } from "./adapt.js";
import { cellCenters } from "../grid/hisban-grid.js";
import { rankCells, refine } from "../matcher/hisban-matcher.js";
import { levenbergMarquardt, DEFAULT_BOUNDS } from "../estimator/index.js";
import { assessObservability } from "../observability/index.js";
import { driftD, outlierStats, classifyState } from "../diagnostics/index.js";

export { DEFAULT_ALGORITHM_CONFIG, NAVIGATION_STATES, SENSOR_STATES, SENSOR_QUALITY, RUN_STATUS } from "./config.js";
export { validateMeasurement, validateAlgorithmConfig } from "./validate.js";
export { toInternal } from "./adapt.js";

/**
 * يشغّل خط الأنابيب على قياسات الشمس.
 * @param {object[]} measurements بصيغة السجل (timestampUtc, solarAltitudeDeg, ...)
 * @param {object} config الإعدادات الخوارزمية (افتراضياً DEFAULT_ALGORITHM_CONFIG)
 * @returns {object} NavigationResult موحَّد
 */
export function runNavigation(measurements, config = DEFAULT_ALGORITHM_CONFIG) {
  // 1) Validation
  const cfgErrors = validateAlgorithmConfig(config);
  if (cfgErrors.length) return rejected(cfgErrors.map((message) => ({ scope: "config", message })));
  const measErrors = [];
  measurements.forEach((m, i) => {
    for (const err of validateMeasurement(m)) measErrors.push({ scope: "measurement", index: i, message: err });
  });
  if (measErrors.length) return rejected(measErrors);

  const N = measurements.length;
  const meas = toInternal(measurements);
  if (N < 2) {
    return {
      status: RUN_STATUS.WAITING,
      estimate: null,
      uncertainty: null,
      navigationState: "UNOBSERVABLE",
      sensorState: "INSUFFICIENT_DATA",
      candidates: [],
      diagnostics: { measurementCount: N, warnings: [{ code: "WAITING", message: "يلزم قياسان على الأقل." }] },
      nextMeasurementRecommendation: recommend("UNOBSERVABLE", "INSUFFICIENT_DATA"),
    };
  }

  // 2) Matcher: أفضل K خلايا من الشبكة الهرمية
  const top = rankCells(cellCenters(config.gridSizeDeg), meas, config.startsK);

  // 3) Refinement: تقسيم متكرر حتى الدقة المستهدفة
  const starts = refine(meas, top, {
    startStep: config.refinementStartDeg,
    minStep: config.refinementTargetDeg,
    keep: config.startsK,
  });

  // 4) Estimator: LM محلي من كل بداية، ثم أفضل نتيجة
  const bounds = { ...DEFAULT_BOUNDS, bMaxDeg: config.biasBoundDeg, localDeg: config.localWindowDeg };
  const runs = starts
    .map((c) => ({ start: { lat: c.lat, lon: c.lon }, ...levenbergMarquardt([c.lat, c.lon, 0], meas, { bounds }) }))
    .sort((a, b) => a.chi2 - b.chi2);
  const best = runs[0];

  // 5) Observability: وضوح الموقع والانحياز بصورة منفصلة
  const obs = assessObservability(best.p, meas, {
    limits: {
      maxSigmaPosKm: config.observabilityPositionSigmaKm,
      maxSigmaBiasDeg: config.observabilityBiasSigmaDeg,
      maxAbsRho: config.observabilityCorrelationLimit,
    },
  });

  // 6) Diagnostics: الانحراف والشواذ (تتطلب 3 قياسات فأكثر)
  const rules = {
    driftD: config.driftDThreshold,
    suspectD: config.suspectDThreshold,
    outlierO: config.outlierGainThreshold,
    outlierT: config.outlierStudentizedThreshold,
    outlierDropOneD: config.outlierDropOneDThreshold,
  };
  let D = null;
  let outliers = [];
  let sensorState;
  let warnings;
  if (N >= 3) {
    D = driftD(best.p, meas).D;
    outliers = outlierStats(meas, best);
    const cls = classifyState({ D, outliers, navigation: obs.mode }, rules);
    sensorState = cls.sensor;
    warnings = cls.warnings;
  } else {
    sensorState = "INSUFFICIENT_DATA";
    warnings = classifyState({ D: 0, outliers: [], navigation: obs.mode }, rules).warnings; // تحذيرات الملاحة فقط
    warnings.push({ code: "INSUFFICIENT_DATA", message: "يلزم ثلاثة قياسات على الأقل لتقييم الحساس." });
  }

  // 7) NavigationResult
  return {
    status: RUN_STATUS.OK,
    estimate: { latitudeDeg: best.p[0], longitudeDeg: best.p[1], biasDeg: best.p[2] },
    // عند تفرد مصفوفة فيشر لا توجد أرقام عدم يقين؛ تُعرض null صراحة لا undefined.
    uncertainty: {
      positionKm: obs.sigmaPosKm ?? null,
      majorKm: obs.majorKm ?? null,
      minorKm: obs.minorKm ?? null,
      rho: obs.rho ?? null,
      biasSigmaDeg: obs.sigmaBiasDeg ?? null,
    },
    navigationState: obs.mode,
    sensorState,
    candidates: runs.slice(0, config.startsK).map((r) => ({
      latitudeDeg: r.p[0],
      longitudeDeg: r.p[1],
      biasDeg: r.p[2],
      chiSquare: r.chi2,
    })),
    diagnostics: {
      measurementCount: N,
      chiSquare: best.chi2,
      converged: best.converged,
      driftD: D,
      outliers: outliers.map((o) => ({ index: o.index, O: o.O, t: o.t, Dminus: o.Dminus })),
      navigationReason: obs.reason,
      warnings,
    },
    nextMeasurementRecommendation: recommend(obs.mode, sensorState),
  };
}

function rejected(errors) {
  return {
    status: RUN_STATUS.REJECTED,
    errors,
    estimate: null,
    uncertainty: null,
    navigationState: null,
    sensorState: null,
    candidates: [],
    diagnostics: null,
    nextMeasurementRecommendation: null,
  };
}

/** توصية مرحلية (نص عربي قصير)، لا تُعرض كدرجة ثقة. */
export function recommend(navigationState, sensorState) {
  if (navigationState === "UNOBSERVABLE") {
    return { code: "COLLECT_LONGER_SPAN", text: "اجمع قياسات على فترة زمنية أطول وبارتفاعات شمس أكثر تنوعاً." };
  }
  if (navigationState === "POSITION_ONLY") {
    return { code: "COLLECT_MORE_GEOMETRY", text: "الموقع مقدَّر لكن الانحراف غير منفصل؛ أضف قياسات بسمت مختلف." };
  }
  if (sensorState === "INSUFFICIENT_DATA") {
    return { code: "COLLECT_MORE", text: "أضف قياساً ثالثاً على الأقل لتقييم البوصلة." };
  }
  if (sensorState === "DRIFT" || sensorState === "OUTLIER_SUSPECT" || sensorState === "SUSPECT") {
    return { code: "RECHECK_SENSOR", text: "راجع معايرة البوصلة وأعد القياسات المشكوك فيها." };
  }
  return { code: "NONE", text: "لا توصية. استمر في القياس إن أردت تضييق عدم اليقين." };
}
