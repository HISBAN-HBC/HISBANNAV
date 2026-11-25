// app.js — ربط الواجهة: مصدر البيانات (Mock أو Replay من ملف جلسة) ← pipeline ← شاشات view-model.
// الواجهة لا تستدعي estimator ولا observability مباشرة.
import { createSession, addRawReading, addMeasurement, addResult, serializeSession, parseSession, replaySession, toSessionEstimate, RAW_STREAMS } from "../research/index.js";
import { runNavigation, DEFAULT_ALGORITHM_CONFIG } from "../pipeline/index.js";
import { buildMockStream } from "./mock-scenario.js";
import * as VM from "./view-model.js";

const START = Date.UTC(2026, 10, 10, 1, 46);
const SCENARIOS = {
  short: { label: "جلسة قصيرة (5 قياسات)", opts: { lat: -35, lon: 150, startUtcMs: START, count: 5, stepMin: 30, compassBiasDeg: 4 } },
  drift: { label: "انحراف 10°/ساعة (9 قياسات)", opts: { lat: -35, lon: 150, startUtcMs: START, count: 9, stepMin: 15, compassBiasDeg: 4, driftDegPerHour: 10 } },
  dropped: { label: "قياس بوصلة مفقود", opts: { lat: -35, lon: 150, startUtcMs: START, count: 6, stepMin: 20, compassBiasDeg: 4, dropAt: 2 } },
};

const state = { tab: "nav", source: "", result: null, timeline: [], session: null, replay: null, skipped: [], error: null };
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const table = (headers, rows) => el("table", {}, el("thead", {}, el("tr", {}, headers.map((h) => el("th", { text: h })))), el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => el("td", { text: String(c) }))))));

/** يبني جلسة v2 من قياسات مع خامها (إن وُجد)، ثم يعرضها. */
function buildSession({ measurements, config, sessionId, raw = null, sourceIndexes = null }) {
  let session = createSession({ sessionId, appVersion: "0.1.0", algorithmVersion: "2026.11", algorithmConfig: config, startedAtUtc: measurements[0]?.timestampUtc ?? new Date().toISOString(), device: { platform: "MOCK", model: "Mock sensors", osVersion: null, sensorCapabilities: ["compass", "imu", "gnss", "clock"] } });
  if (raw) for (const stream of RAW_STREAMS) for (const r of raw[stream]) session = addRawReading(session, stream, r);
  measurements.forEach((m, i) => { session = addMeasurement(session, m, sourceIndexes ? sourceIndexes[i] : null); });
  const result = runNavigation(measurements, config);
  if (result.status === "OK") session = addResult(session, toSessionEstimate(result));
  return session;
}

/** يعرض جلسة (مبنية أو محمّلة من ملف). الحالة تُحسب من القياسات المسجَّلة نفسها. */
function showSession(session, { source, skipped = [] }) {
  const config = session.algorithmConfig;
  const measurements = session.measurements;
  const result = runNavigation(measurements, config);
  const timeline = measurements.map((m, i) => ({
    count: i + 1,
    timestampUtc: m.timestampUtc,
    result: runNavigation(measurements.slice(0, i + 1), config),
  }));
  Object.assign(state, { source, result, timeline, session, replay: replaySession(session), skipped, error: null });
  render();
}

function runMock(key) {
  const { measurements, sourceIndexes, raw, skipped } = buildMockStream(SCENARIOS[key].opts);
  const session = buildSession({ measurements, config: DEFAULT_ALGORITHM_CONFIG, sessionId: `MOCK-${key}-${Date.now()}`, raw, sourceIndexes });
  showSession(session, { source: `تجريبي (Mock): ${SCENARIOS[key].label}، بلا ضوضاء`, skipped });
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const session = parseSession(String(reader.result));
      showSession(session, { source: `ملف جلسة: ${file.name} (المخطط ${session.schemaVersion})` });
    } catch (e) {
      state.error = `تعذّر تحميل الجلسة: ${e.message}`;
      render();
    }
  };
  reader.readAsText(file);
}

function exportSession() {
  if (!state.session) return;
  const blob = new Blob([serializeSession(state.session)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${state.session.sessionId}.json` });
  document.body.append(a); a.click(); a.remove();
}

function renderStatus() {
  const sb = VM.statusBar(state.result);
  $("status").replaceChildren(
    el("div", { class: "pill" }, el("span", { class: "k", text: sb.navigation.label }), el("strong", { text: sb.navigation.text ?? "—" })),
    el("div", { class: "pill" }, el("span", { class: "k", text: sb.sensor.label }), el("strong", { text: sb.sensor.text ?? "—" })),
  );
  $("source").textContent = state.source || "لم تُحمَّل بيانات بعد";
}

function navPanel() {
  const s = VM.navigationScreen(state.result);
  const kids = [el("p", { class: "muted", text: `الملاحة: ${s.navigationLabel ?? "—"}` })];
  if (s.showPosition) {
    kids.push(table(["خط العرض", "خط الطول", "عدم اليقين (كم)"], [[s.position.latitude, s.position.longitude, `±${s.position.uncertaintyKm}`]]));
    kids.push(el("p", { class: "note", text: s.position.uncertaintyNote }));
  }
  if (s.message) kids.push(el("p", { class: "warn", text: s.message }));
  if (s.recommendation) kids.push(el("p", { text: `التوصية: ${s.recommendation}` }));
  return kids;
}

function sessionPanel() {
  const rows = VM.sessionScreen(state.timeline).rows.map((r) => [r.count, r.timestampUtc, r.status, r.navigation, r.sensor]);
  const kids = [table(["القياسات", "الوقت (UTC)", "النتيجة", "الملاحة", "الحساس"], rows)];
  if (state.skipped.length) kids.push(el("p", { class: "warn", text: `قراءات متخطاة: ${state.skipped.map((x) => `#${x.index + 1} (${x.reason})`).join("، ")}` }));
  return kids;
}

function diagPanel() {
  const d = VM.diagnosticsScreen(state.result);
  if (!d.available) return [el("p", { text: d.message })];
  const kids = [
    table(["المؤشر", "القيمة"], [["D (انحراف البوصلة)", d.driftD], ["χ²", d.chiSquare], ["تقارب LM", d.converged], ["سبب حالة الملاحة", d.navigationReason]]),
    el("h3", { text: "الشواذ" }),
    d.outliers.length ? table(["القياس", "O", "t", "D₋ᵢ"], d.outliers.map((o) => [o.index, o.O, o.t, o.Dminus])) : el("p", { class: "muted", text: "لا شواذ مسجّلة." }),
    el("h3", { text: "التحذيرات" }),
    d.warnings.length ? el("ul", {}, d.warnings.map((w) => el("li", { text: w }))) : el("p", { class: "muted", text: "لا تحذيرات." }),
    el("h3", { text: "أفضل المرشحين" }),
    table(["الترتيب", "خط العرض", "خط الطول", "χ²"], d.candidates.map((c) => [c.rank, c.latitude, c.longitude, c.chiSquare])),
  ];
  return kids;
}

function researchPanel() {
  if (!state.session) return [el("p", { text: "لا جلسة بعد." })];
  const r = VM.researchScreen(state.session, { replay: state.replay });
  return [
    table(["المعرف", "المخطط", "عدد القياسات", "إعادة الإنتاج"], [[r.sessionId, r.schemaVersion, r.measurementCount, r.replay]]),
    el("h3", { text: "الإعدادات المسجّلة" }),
    el("p", { class: "note", text: "الإعدادات المعلَّمة «مؤقتة» مشتقة من المحاكاة ولم تُختبر على جهاز حقيقي." }),
    table(["المفتاح", "القيمة", "الحالة"], r.config.map((c) => [c.key, c.value, c.provisional ? "مؤقتة" : "معتمدة"])),
    el("button", { type: "button", onclick: exportSession, text: "تنزيل الجلسة (JSON)" }),
  ];
}

const PANELS = { nav: navPanel, session: sessionPanel, diag: diagPanel, research: researchPanel };
const TITLES = { nav: "الملاحة", session: "جلسة القياس", diag: "التشخيص", research: "البحث" };

function render() {
  renderStatus();
  $("error").textContent = state.error ?? "";
  const tabs = $("tabs");
  tabs.replaceChildren(...Object.keys(PANELS).map((k) =>
    el("button", { type: "button", class: k === state.tab ? "tab on" : "tab", onclick: () => { state.tab = k; render(); }, text: TITLES[k] }),
  ));
  $("panel").replaceChildren(el("h2", { text: TITLES[state.tab] }), ...(state.result ? PANELS[state.tab]() : [el("p", { text: "شغّل محاكاة أو أعد تشغيل جلسة لعرض النتائج." })]));
}

function init() {
  $("scenarios").replaceChildren(...Object.entries(SCENARIOS).map(([k, s]) => el("button", { type: "button", onclick: () => runMock(k), text: s.label })));
  $("file").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
  render();
}
init();
