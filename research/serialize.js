// serialize.js — تسلسل ثابت (مفاتيح مرتبة) وتحليل مع فحص الإصدار. يقبل v1 و v2.

import { SUPPORTED_SCHEMA_VERSIONS, SCHEMA_VERSION, validateMeasurement, validateAlgorithmConfig } from "./schema.js";
import { RAW_STREAMS, validateRawRecord, checkSourceIndexes } from "./raw.js";

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

export function serializeSession(session) {
  return JSON.stringify(sortKeys(session), null, 2) + "\n";
}

export function parseSession(text) {
  const s = JSON.parse(text);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(s.schemaVersion)) throw new Error(`research: unsupported schemaVersion ${s.schemaVersion}`);
  const cfgErrors = validateAlgorithmConfig(s.algorithmConfig);
  if (cfgErrors.length) throw new Error(`research: ${cfgErrors.join("; ")}`);
  if (!Array.isArray(s.measurements)) throw new Error("research: measurements must be an array");
  s.measurements.forEach((m, i) => {
    const errs = validateMeasurement(m);
    if (errs.length) throw new Error(`research: measurement ${i}: ${errs.join("; ")}`);
  });

  if (s.schemaVersion === SCHEMA_VERSION) {
    if (!("estimate" in s)) throw new Error("research: v1 session must have an estimate field (may be null)");
    return Object.freeze(s);
  }

  // v2
  if (!s.rawSensors || !RAW_STREAMS.every((k) => Array.isArray(s.rawSensors[k]))) {
    throw new Error("research: v2 session needs rawSensors with compass, imu, gnss and clock arrays");
  }
  for (const stream of RAW_STREAMS) {
    s.rawSensors[stream].forEach((r, i) => {
      const errs = validateRawRecord(stream, r);
      if (errs.length) throw new Error(`research: ${stream}[${i}]: ${errs.join("; ")}`);
    });
  }
  if (!Array.isArray(s.results)) throw new Error("research: v2 session needs a results array");
  s.measurements.forEach((m, i) => {
    const errs = checkSourceIndexes(s, m.sourceSensorIndexes);
    if (errs.length) throw new Error(`research: measurement ${i}: ${errs.join("; ")}`);
  });
  return Object.freeze(s);
}
