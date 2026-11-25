// index.js — واجهة وحدة التشخيص.
export { driftD, azimuthResiduals } from "./drift.js";
export { outlierStats } from "./outlier.js";
export { classifySensor, classifyState, DEFAULT_RULES } from "./state-classifier.js";
