// gate-eval.mjs — تحليل محاكاة البوابة واختيار العتبات من منحنى المقايضة.
// المقاييس:
//   Rescue        = P(E_B < E_A)                      البوابة حسّنت النتيجة
//   FalseSwitch   = P(حوّلت، وE_A < E_P)              حوّلت رغم أن المشترك كان أفضل
//   MissedHarm    = P(لم تحوّل، وE_A > 300 وE_P < E_A) الخطر لم يُكتشف
//   LateSwitch    = P(حوّلت، وأول إنذار بعد القياس الفاسد بقياسين أو أكثر)
//   ΔE            = E_A − E_B  (موجب = التحويل أنقذ الحل)
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("./gate-records.json", import.meta.url), "utf8"));
const TRIALS = data.TRIALS;

const GRID = {
  z: [2, 3, 4, 5, 6, 8],
  bAbs: [17, 18.5, 19.5, 20],
  rms: [1.5, 2.0, 2.5, 3.0, 4.0],
  sigB: [2.5, 4, 6, 8, 12],
};
const MAX_FALSE = 0.10; // قيد: لا تتجاوز التحويلات الخاطئة 10%

// يعيد {switched, switchK} لتجربة وفق العتبات
function evaluate(rec, th) {
  for (const s of rec.signals) {
    if (s.z > th.z || s.bAbs > th.bAbs || s.rms > th.rms || s.sigB > th.sigB) {
      return { switched: true, switchK: s.k };
    }
  }
  return { switched: false, switchK: null };
}

function metrics(th, cells) {
  let n = 0, rescue = 0, falseSw = 0, missed = 0, switched = 0, lateN = 0, lateDen = 0;
  for (const cell of cells) {
    for (const rec of cell.recs) {
      n++;
      const { switched: sw, switchK } = evaluate(rec, th);
      const EB = sw ? rec.EP : rec.EA;
      if (EB < rec.EA) rescue++;
      if (sw) {
        switched++;
        if (rec.EA < rec.EP) falseSw++;
        if (rec.onset !== null) {
          lateDen++;
          if (switchK >= rec.onset + 2) lateN++;
        }
      } else if (rec.EA > 300 && rec.EP < rec.EA) {
        missed++;
      }
    }
  }
  return {
    rescue: rescue / n,
    falseSwitch: falseSw / n,
    missed: missed / n,
    switchRate: switched / n,
    late: lateDen ? lateN / lateDen : NaN,
  };
}

function* grid() {
  for (const z of GRID.z) for (const bAbs of GRID.bAbs) for (const rms of GRID.rms) for (const sigB of GRID.sigB) {
    yield { z, bAbs, rms, sigB };
  }
}

const f = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");
const out = [];
out.push(`TRIALS = ${TRIALS} لكل سيناريو، ${data.records.length} سيناريو-إعداد\n`);

// ---------- منحنى المقايضة على كل السيناريوهات ----------
const frontier = [];
for (const th of grid()) {
  const m = metrics(th, data.records);
  frontier.push({ th, ...m, score: m.rescue - m.falseSwitch });
}
frontier.sort((a, b) => b.score - a.score);
out.push("## منحنى المقايضة (أفضل 10 حسب الإنقاذ − التحويل الخاطئ، كل السيناريوهات والإعدادات)");
out.push("| z | |b| | rms | σ_b | الإنقاذ | تحويل خاطئ | خطر لم يُكتشف | نسبة التحويل | متأخر |");
out.push("|---|---|---|---|---|---|---|---|---|");
for (const r of frontier.slice(0, 10)) {
  out.push(`| ${r.th.z} | ${r.th.bAbs} | ${r.th.rms} | ${r.th.sigB} | ${f(r.rescue)} | ${f(r.falseSwitch)} | ${f(r.missed)} | ${f(r.switchRate)} | ${f(r.late, 0)} |`);
}

// الاختيار: أعلى نتيجة مع قيد التحويل الخاطئ
const feasible = frontier.filter((r) => r.falseSwitch <= MAX_FALSE);
if (!feasible.length) out.push(`\n!! لا توجد نقطة في الشبكة تحقق قيد التحويل الخاطئ ≤ ${MAX_FALSE * 100}%`);
const chosen = (feasible[0] ?? frontier[0]).th;
out.push(`\nالعتبات المختارة: z>${chosen.z}، |b|>${chosen.bAbs}، rms>${chosen.rms}، σ_b>${chosen.sigB}${feasible.length ? "" : " (بدون قيد مستوفى)"}`);
out.push(`نقاط الشبكة التي تحقق القيد: ${feasible.length}`);

// ---------- تفصيل حسب الإعداد والسيناريو ----------
out.push("\n## تفصيل بالعتبات المختارة: P95 للموقع (كم)");
out.push("| الإعداد | السيناريو | Joint دائماً | Position-only دائماً | Gated | الإنقاذ | تحويل خاطئ | خطر لم يُكتشف | متأخر |");
out.push("|---|---|---|---|---|---|---|---|---|");
const p95 = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))];
};
const perCell = [];
for (const cell of data.records) {
  const EA = cell.recs.map((r) => r.EA);
  const EP = cell.recs.map((r) => r.EP);
  const EB = cell.recs.map((r) => (evaluate(r, chosen).switched ? r.EP : r.EA));
  const m = metrics(chosen, [cell]);
  perCell.push({ cell: cell.config, scen: cell.scenario, EA, EP, EB, m });
  out.push(`| ${cell.config} | ${cell.label} | ${p95(EA).toFixed(0)} | ${p95(EP).toFixed(0)} | ${p95(EB).toFixed(0)} | ${f(m.rescue)} | ${f(m.falseSwitch)} | ${f(m.missed)} | ${f(m.late, 0)} |`);
}

// ---------- القرار النهائي: هل Gated أفضل من Joint دائماً أو Position-only دائماً؟ ----------
out.push("\n## هل Gated أفضل من البدائل؟ (متوسط ΔE ونسبة الحالات التي يتفوق فيها)");
out.push("| الإعداد | متوسط ΔE مقابل Joint | Gated أفضل من Joint | متوسط ΔE مقابل Position-only | Gated أفضل من Position-only |");
out.push("|---|---|---|---|---|");
const byCfg = {};
for (const p of perCell) (byCfg[p.cell] ??= []).push(p);
for (const [cfg, arr] of Object.entries(byCfg)) {
  let dA = [], dP = [], winA = 0, winP = 0, n = 0;
  for (const p of arr) {
    for (let i = 0; i < p.EA.length; i++) {
      dA.push(p.EA[i] - p.EB[i]);
      dP.push(p.EP[i] - p.EB[i]);
      if (p.EB[i] < p.EA[i]) winA++;
      if (p.EB[i] < p.EP[i]) winP++;
      n++;
    }
  }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  out.push(`| ${cfg} | ${mean(dA).toFixed(0)} | ${f(winA / n)} | ${mean(dP).toFixed(0)} | ${f(winP / n)} |`);
}

console.log(out.join("\n"));
