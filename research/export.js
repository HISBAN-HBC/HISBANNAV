// export.js — تصدير الجلسة: JSON كامل، وCSV لجدول القياسات فقط للفحص السريع.

import { serializeSession } from "./serialize.js";

export function exportJson(session) {
  return serializeSession(session);
}

export function exportMeasurementsCsv(session) {
  const cols = ["timestampUtc", "solarAltitudeDeg", "solarAzimuthDeg", "sigmaAltitudeDeg", "sigmaAzimuthDeg", "compassHeadingDeg", "sensorQuality"];
  const esc = (v) => (v === null || v === undefined ? "" : String(v));
  const rows = session.measurements.map((m) => cols.map((c) => esc(m[c])).join(","));
  return [cols.join(","), ...rows].join("\n") + "\n";
}
