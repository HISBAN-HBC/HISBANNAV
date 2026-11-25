// schema.js — مخطط الجلسة. الإصدار 1: قياسات مجمّعة فقط (قديم، للقراءة فقط).
// الإصدار 2: قياسات مجمّعة + قراءات خام للحساسات + الجهاز. هذا هو الإصدار الحالي للتسجيل.
// المفردات والإعدادات والتحقق من القياس تُعرَّف في pipeline/، وتُعاد تصديرها هنا.
export const SCHEMA_VERSION = 1;
export const SCHEMA_VERSION_V2 = 2;
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION_V2;
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([SCHEMA_VERSION, SCHEMA_VERSION_V2]);
export { DEFAULT_ALGORITHM_CONFIG, NAVIGATION_STATES, SENSOR_STATES, SENSOR_QUALITY } from "../pipeline/config.js";
export { validateMeasurement, validateAlgorithmConfig } from "../pipeline/validate.js";
