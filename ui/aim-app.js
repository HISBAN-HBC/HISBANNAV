// aim-app.js — ربط صفحة التصويب بالمتصفح. المنطق في aim-core.js؛ هنا DOM فقط.
import { createSession, addRawReading, setTruth, serializeSession, parseSession, replaySession } from "../research/index.js";
import { BrowserOrientationProvider, BrowserGnssProvider } from "../sensors/index.js";
import { DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { recordAimWindow } from "./aim-core.js";
import { loadCalibration, offsetFor } from "./calibration-store.js";

const WINDOW_MS = 1000;
const $ = (id) => document.getElementById(id);
const orientation = new BrowserOrientationProvider(globalThis);
const gnss = new BrowserGnssProvider(globalThis);
const calRecord = loadCalibration(localStorage, { userAgent: navigator.userAgent });
let session = createSession({
  calibration: { offsetQuaternion: offsetFor(calRecord) },
  sessionId: `AIM-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  appVersion: "0.1.0",
  algorithmVersion: "2026.11",
  algorithmConfig: DEFAULT_ALGORITHM_CONFIG,
  device: {
    platform: /Android/.test(navigator.userAgent) ? "ANDROID_CHROME" : "BROWSER_OTHER",
    model: null,
    osVersion: null,
    sensorCapabilities: [orientation.supported ? "absolute-orientation" : "none", "geolocation"],
  },
});
let lastOutcome = null;

function status() {
  const o = orientation.read();
  const g = gnss.read();
  $("status").textContent =
    `الوضعية: ${o.available ? "متاحة" : `غير متاحة (${o.reason})`} — ` +
    `GNSS: ${g.available ? `±${g.accuracyM.toFixed(0)} م` : `غير متاح (${g.reason})`} — ` +
    `القياسات المقبولة: ${session.measurements.length} — الخام: ${session.rawSensors.imu.length}` +
    ` — المعايرة: ${calRecord ? calRecord.calibratedAtUtc + (calRecord.deviceMismatch ? " (جهاز آخر!)" : "") : "مفقودة (إزاحة صفر)"}`;
}

function render() {
  status();
  $("outcome").textContent = lastOutcome ? (lastOutcome.ok ? `تم القياس رقم ${lastOutcome.measurementCount}.` : lastOutcome.message) : "";
  const r = session.results.at(-1);
  $("result").textContent = r
    ? `آخر تقدير: ${r.latitudeDeg.toFixed(4)}, ${r.longitudeDeg.toFixed(4)} — الملاحة: ${r.navigationState} — الحساس: ${r.sensorState}`
    : "لا تقدير بعد (يلزم قياسان مقبولان على الأقل).";
}

$("start").addEventListener("click", () => {
  orientation.start();
  gnss.start();
  render();
});

$("measure").addEventListener("click", async () => {
  const t0 = Date.now();
  $("measure").disabled = true;
  $("outcome").textContent = "ثبّت الهاتف… جارٍ جمع العينات.";
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const samples = orientation.samplesBetween(t0, Date.now());
  const out = recordAimWindow(session, samples);
  session = out.session;
  lastOutcome = out.outcome;
  $("measure").disabled = false;
  render();
});

$("truth").addEventListener("click", () => {
  const g = gnss.read();
  if (!g.available) {
    $("outcome").textContent = `لا يمكن تعيين المرجع: ${g.reason}`;
    return;
  }
  session = addRawReading(session, "gnss", g);
  session = setTruth(session, { gnssLatitudeDeg: g.latitudeDeg, gnssLongitudeDeg: g.longitudeDeg, accuracyM: g.accuracyM });
  render();
});

$("download").addEventListener("click", () => {
  const blob = new Blob([serializeSession(session)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${session.sessionId}.json`;
  a.click();
});

$("replay").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const loaded = parseSession(await file.text());
    const r = replaySession(loaded, { level: "raw" });
    $("replayResult").textContent = r.reproducible === null
      ? `لا يمكن الفحص: ${r.reason}`
      : r.reproducible ? "إعادة التشغيل من الخام مطابقة للتسجيل." : `غير مطابقة: ${r.diffs.join("، ")}`;
  } catch (err) {
    $("replayResult").textContent = `تعذّر تحميل الملف: ${err.message}`;
  }
});

setInterval(render, 500);
render();
