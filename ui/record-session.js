// record-session.js — يبني جلسة v2 كاملة من محاكاة Mock: قراءات خام + قياسات مرتبطة + نتيجة.
import { createSession, addRawReading, addMeasurement, addResult, toSessionEstimate, RAW_STREAMS } from "../research/index.js";
import { runNavigation, DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { buildMockStream } from "./mock-scenario.js";

export function recordSession(opts, { sessionId = "LOOP-1" } = {}) {
  const { measurements, sourceIndexes, raw, skipped } = buildMockStream(opts);
  let s = createSession({
    sessionId, appVersion: "0.1.0", algorithmVersion: "2026.11", algorithmConfig: DEFAULT_ALGORITHM_CONFIG,
    startedAtUtc: measurements[0]?.timestampUtc, device: { platform: "MOCK" },
  });
  for (const stream of RAW_STREAMS) for (const r of raw[stream]) s = addRawReading(s, stream, r);
  measurements.forEach((m, i) => { s = addMeasurement(s, m, sourceIndexes[i]); });
  s = addResult(s, toSessionEstimate(runNavigation(measurements, DEFAULT_ALGORITHM_CONFIG)));
  return { session: s, skipped };
}
