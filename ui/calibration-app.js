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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// يعرض عدًا تنازليًا قبل كل وضع، ليتسنى للمستخدم تغيير وضع الهاتف دون قلب يدوي متعجّل.
async function countdown(seconds, prompt) {
  for (let s = seconds; s > 0; s--) {
    $("outcome").textContent = `${prompt} — ابدأ بعد ${s}…`;
    await wait(1000);
  }
}

// زر واحد: الوضع الأول، ثم عدّ تنازلي، ثم الوضع الثاني، ثم الحساب والحفظ تلقائيًا.
async function runSequence() {
  if (orientation.read().available === false) {
    $("outcome").textContent = "الحساسات غير مفعّلة. اضغط «تشغيل الحساسات» أولًا.";
    return;
  }
  pending.nadir = null;
  pending.zenith = null;
  $("sequence").disabled = true;
  try {
    await countdown(3, "ضع الهاتف مسطحًا، الكاميرا تنظر للأسفل");
    await measure("nadir");
    if (!pending.nadir) return;
    await countdown(4, "ارفع الهاتف واقلبه، الكاميرا تنظر للأعلى");
    await measure("zenith");
    if (!pending.zenith) return;
    saveNow();
  } finally {
    $("sequence").disabled = false;
  }
}

$("start").addEventListener("click", () => { orientation.start(); status(); });
$("sequence").addEventListener("click", runSequence);

function saveNow() {
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
}

setInterval(status, 500);
showStored();
status();
