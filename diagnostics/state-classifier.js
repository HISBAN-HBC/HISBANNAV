// state-classifier.js — حالتان منفصلتان (القسم 15 و16 من المواصفة):
//   sensor:     STABLE | DRIFT | OUTLIER_SUSPECT | SUSPECT
//   navigation: OBSERVABLE | POSITION_ONLY | UNOBSERVABLE   (تأتي من observability)
// JUMP_SUSPECT تحذير فقط، ولا يُنتَج هنا إلا من مصدر خارجي صريح، ولا تأكيد من الشمس وحدها.
// القواعد التشغيلية (المواصفة، القسم 18–19):
//   DRIFT: D ≥ 3
//   OUTLIER_SUSPECT: O > 10 و |t| > 3 و D₋ᵢ < 2 (تحذير فقط، بلا حذف تلقائي)

export const DEFAULT_RULES = Object.freeze({
  driftD: 3,
  suspectD: 2,
  outlierO: 10,
  outlierT: 3,
  outlierDropOneD: 2,
});

export function classifySensor({ D, outliers = [] }, rules = DEFAULT_RULES) {
  const warnings = [];
  const suspicious = outliers.filter(
    (o) => o.O > rules.outlierO && Math.abs(o.t) > rules.outlierT && o.Dminus < rules.outlierDropOneD,
  );
  for (const o of suspicious) {
    warnings.push({ code: "OUTLIER_SUSPECT", index: o.index, message: `القياس ${o.index + 1} غير متسق مع باقي السلسلة. أعد القياس.` });
  }
  let sensor;
  if (D >= rules.driftD) {
    sensor = "DRIFT";
    warnings.push({ code: "DRIFT", message: "اتجاه البوصلة يتغير تدريجياً. الموقع لا يزال قيد التقدير، لكن الثقة خُفضت." });
  } else if (suspicious.length > 0) {
    sensor = "OUTLIER_SUSPECT";
  } else if (D >= rules.suspectD) {
    sensor = "SUSPECT";
    warnings.push({ code: "SUSPECT", message: "يوجد عدم اتساق غير محسوم في القياسات." });
  } else {
    sensor = "STABLE";
  }
  return { sensor, warnings };
}

export function classifyState({ D, outliers = [], navigation }, rules = DEFAULT_RULES) {
  const { sensor, warnings } = classifySensor({ D, outliers }, rules);
  const all = [...warnings];
  if (navigation === "POSITION_ONLY") all.push({ code: "POSITION_ONLY", message: "المعلومات الحالية غير كافية لتقدير انحياز البوصلة بصورة مستقلة وموثوقة." });
  if (navigation === "UNOBSERVABLE") all.push({ code: "UNOBSERVABLE", message: "الهندسة الحالية لا توفر موقعاً موثوقاً. انتظر قياساً لاحقاً." });
  return { sensor, navigation, warnings: all };
}
