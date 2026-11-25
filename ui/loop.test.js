// loop.test.js — الحلقة الكاملة: تسجيل جلسة بخامها، حفظها، تحميلها، وإعادة تشغيلها على المستويين.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSession, parseSession, replaySession } from "../research/index.js";
import { recordSession } from "./record-session.js";


const OPTS = { lat: -35, lon: 150, startUtcMs: Date.UTC(2026, 10, 10, 1, 46), count: 6, stepMin: 20, compassBiasDeg: 4 };

test("record → save → reload → replay reproduces at both levels", () => {
  const { session } = recordSession(OPTS);
  const loaded = parseSession(serializeSession(session));
  assert.equal(replaySession(loaded).level, "raw");
  assert.equal(replaySession(loaded).reproducible, true);
  assert.equal(replaySession(loaded, { level: "measurement" }).reproducible, true);
  assert.equal(replaySession(loaded).recomputed.navigationState, session.results[0].navigationState);
});
