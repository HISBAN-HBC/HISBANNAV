// calibration-app.js — ربط شاشة المعايرة بالمتصفح. المنطق في calibration-core.js والحفظ في calibration-store.js.
import { BrowserOrientationProvider } from "../sensors/index.js";
import { DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { calibrate } from "./calibration-core.js";
import { saveCalibration, loadCalibration } from "./calibration-store.js";

const WINDOW_MS = 1000;
const $ = (id) => document.getElementById(id);
const orientation = new BrowserOrientationProvider(globalThis);
const ua = navigator.userAgent;
const platform = /Android/.test(ua) ? "ANDROID_CHROME" : "BROWSER_OTHER";
const pending = { nadir: null, zenith: null };

function showStored() {
  const rec = loadCalibration(localStorage, { userAgent: ua });
  $("stored").textContent = rec
    ? `المعايرة المحفوظة: ${rec.calibratedAtUtc} — الإزاحة ${rec.cameraBoresightOffsetDeg.toFixed(2)}°` +
      (rec.deviceMismatch ? " — تنبيه: سُجلت على جهاز آخر." : "")
    : "لا توجد معايرة محفوظة. ستُستخدم إزاحة صفر في القياس.";
}

function status() {
  const o = orientation.read();
  $("status").textContent = o.available ? "الوضعية متاحة." : `الوضعية غير متاحة: ${o.reason}`;
  $("pose").textContent = `الوضع الأول (الكاميرا للأسفل): ${pending.nadir ? "قُيس" : "لم يُقَس"} — ` +
    `الوضع الثاني (الكاميرا للأعلى): ${pending.zenith ? "قُيس" : "لم يُقَس"}`;
}

async function measure(which) {
  const t0 = Date.now();
  $("outcome").textContent = "ثبّت الهاتف… جارٍ جمع العينات.";
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const samples = orientation.samplesBetween(t0, Date.now());
  if (samples.length === 0) {
    $("outcome").textContent = `لا عينات: ${orientation.read().reason ?? "تأكد من تشغيل الحساسات"}`;
    return;
  }
  pending[which] = samples;
  $("outcome").textContent = `قُيس الوضع (${samples.length} عينة). انتقل إلى الوضع التالي.`;
  status();
}

$("start").addEventListener("click", () => { orientation.start(); status(); });
$("nadir").addEventListener("click", () => measure("nadir"));
$("zenith").addEventListener("click", () => measure("zenith"));

$("save").addEventListener("click", () => {
  if (!pending.nadir || !pending.zenith) {
    $("outcome").textContent = "قِس الوضعين أولاً.";
    return;
  }
  const r = calibrate({
    nadirSamples: pending.nadir,
    zenithSamples: pending.zenith,
    cfg: DEFAULT_ALGORITHM_CONFIG,
    device: { userAgent: ua, platform, calibratedAtUtc: new Date().toISOString() },
  });
  if (!r.ok) {
    $("outcome").textContent = `لم تُحفظ المعايرة: ${r.message ?? r.reason} (المرحلة: ${r.stage})`;
    return;
  }
  saveCalibration(localStorage, r.record);
  $("outcome").textContent = `حُفظت المعايرة. الإزاحة ${r.record.cameraBoresightOffsetDeg.toFixed(2)}°، ` +
    `ارتفاع الوضع الأول ${r.record.nadirAltDeg.toFixed(1)}°، الثاني ${r.record.zenithAltDeg.toFixed(1)}°.` +
    (r.warnings.length ? ` ${r.warnings.join(" ")}` : "");
  showStored();
});

setInterval(status, 500);
showStored();
status();
