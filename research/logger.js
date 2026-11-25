// logger.js — مسجّل الجلسة: يحتفظ بسجل أحداث زمني ويكتب عبر sink يحقنه المستدعي (ملف، تخزين، أو مصفوفة).

export function createLogger({ sink = () => {} } = {}) {
  const events = [];
  const emit = (type, payload) => {
    const ev = Object.freeze({ type, atUtc: new Date().toISOString(), payload });
    events.push(ev);
    sink(ev);
    return ev;
  };
  return Object.freeze({
    events: () => [...events],
    sessionStarted: (session) => emit("SESSION_STARTED", { sessionId: session.sessionId }),
    measurementAdded: (index) => emit("MEASUREMENT_ADDED", { index }),
    estimateRecorded: (estimate) => emit("ESTIMATE_RECORDED", { navigationState: estimate.navigationState, sensorState: estimate.sensorState }),
    truthRecorded: (truth) => emit("TRUTH_RECORDED", { accuracyM: truth.accuracyM }),
    warning: (code, message) => emit("WARNING", { code, message }),
  });
}
