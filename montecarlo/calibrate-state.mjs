// calibrate-state.mjs — معايرة حدود مصنف الحالة من features.json (شبكة + مصفوفة ارتباك)
// الترتيب: OUTLIER > JUMP > DRIFT > SUSPECT > STABLE
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("./features.json", import.meta.url), "utf8"));
const GRID = { tO: [10, 20, 30, 50, 80], tJ: [3, 5, 8, 12, 20], tChi: [6.63, 10, 15, 25, 40], zMin: [2, 3, 4], kappa: [1, 1.5, 2, 3, 4] };
const D_DRIFT = 3, D_SUSPECT = 2;

function classify(f, th) {
  // شذوذ منفرد: حذف القياس يزيل الاتجاه أيضاً (D₋ᵢ < 2)
  if (f.Omax > th.tO && f.Dminus < 2) return "OUTLIER";
  // قفزة: الانحياز المقسوم أفضل من الميل الخطي
  if (f.dJ > th.tJ && f.dJ >= th.kappa * f.dchi1) return "JUMP";
  if (f.D >= D_DRIFT && f.dchi1 > th.tChi && f.zb > th.zMin) return "DRIFT";
  if (f.D >= D_SUSPECT) return "SUSPECT";
  return "STABLE";
}
// تطبيع بالضوضاء المقدّرة من المخلفات نفسها (يحمي من σ_A خاطئ)
for (const s of data.out) for (const x of s.recs) {
  const s2 = 1; // التطبيع بـχ² أخفى الانحراف نفسه (انظر التقرير)
  x.D = x.D / Math.sqrt(s2);
  x.Omax = x.Omax / s2;
  x.Dminus = x.Dminus / Math.sqrt(s2);
  x.dJ = x.dJ / s2;
  x.dchi1 = x.dchi1 / s2;
}
const rate = (arr, pred) => arr.filter(pred).length / arr.length;
const bySc = Object.fromEntries(data.out.map((s) => [s.key, s]));

function score(th) {
  const r = {};
  for (const s of data.out) r[s.key] = {
    STABLE: rate(s.recs, (f) => classify(f, th) === "STABLE"),
    notDrift: rate(s.recs, (f) => classify(f, th) !== "DRIFT"),
    DRIFT: rate(s.recs, (f) => classify(f, th) === "DRIFT"),
    OUTLIER: rate(s.recs, (f) => classify(f, th) === "OUTLIER"),
    JUMP: rate(s.recs, (f) => classify(f, th) === "JUMP"),
  };
  // أهداف المستخدم:
  const ok = r.stable.notDrift >= 0.95 && r.stable_sA5.notDrift >= 0.95 &&
    r.drift3.DRIFT >= 0.95 && r.drift5.DRIFT >= 0.95 &&
    r.outlier15.DRIFT <= 0.05 && r.jump8.DRIFT <= 0.05;
  return { r, ok };
}

const results = [];
for (const tO of GRID.tO) for (const tJ of GRID.tJ) for (const tChi of GRID.tChi) for (const zMin of GRID.zMin) for (const kappa of GRID.kappa) {
  const th = { tO, tJ, tChi, zMin, kappa };
  const { r, ok } = score(th);
  results.push({ th, r, ok, minDrift: Math.min(r.drift3.DRIFT, r.drift5.DRIFT) });
}
// مجموع الانتهاكات (بوحدات النسبة) لكل هدف؛ الأقل أفضل
function violation(r) {
  return Math.max(0, 0.95 - r.stable.notDrift) + Math.max(0, 0.95 - r.stable_sA5.notDrift) +
    Math.max(0, 0.95 - r.drift3.DRIFT) + Math.max(0, 0.95 - r.drift5.DRIFT) +
    Math.max(0, r.outlier15.DRIFT - 0.05) + Math.max(0, r.jump8.DRIFT - 0.05);
}
const feasible = results.filter((x) => x.ok).sort((a, b) => b.minDrift - a.minDrift);
for (const x of results) x.viol = violation(x.r);
const leastViol = [...results].sort((a, b) => a.viol - b.viol);
const f = (x) => (x * 100).toFixed(1) + "%";
const out = [];
out.push(`عدد النقاط في الشبكة: ${results.length}، المحققة للأهداف: ${feasible.length}`);
const pick = feasible[0] ?? leastViol[0];
out.push(`أقل مجموع انتهاكات: ${leastViol[0].viol.toFixed(3)}`);
out.push(`الاختيار: tO=${pick.th.tO}، tJ=${pick.th.tJ}، tChi=${pick.th.tChi}، zMin=${pick.th.zMin}، κ=${pick.th.kappa}${feasible.length ? "" : "  (لا نقطة تحقق كل الأهداف، أفضل تقريب)"}`);
out.push("\n## مصفوفة الارتباك (نسب القرار لكل حالة حقيقية)");
out.push("| الحالة الحقيقية | STABLE | SUSPECT | DRIFT | OUTLIER | JUMP |");
out.push("|---|---|---|---|---|---|");
for (const s of data.out) {
  const row = { STABLE: 0, SUSPECT: 0, DRIFT: 0, OUTLIER: 0, JUMP: 0 };
  for (const x of s.recs) row[classify(x, pick.th)]++;
  const n = s.recs.length;
  out.push(`| ${s.key} | ${f(row.STABLE / n)} | ${f(row.SUSPECT / n)} | ${f(row.DRIFT / n)} | ${f(row.OUTLIER / n)} | ${f(row.JUMP / n)} |`);
}
out.push("\n## أفضل 8 نقاط (حسب أقل انتهاكات للأهداف)");
out.push("| tO | tJ | tChi | zMin | κ | drift3 | drift5 | stable غير-DRIFT | stable_sA5 غير-DRIFT | outlier→DRIFT | jump→DRIFT | يحقق الأهداف |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const x of leastViol.slice(0, 8)) {
  out.push(`| ${x.th.tO} | ${x.th.tJ} | ${x.th.tChi} | ${x.th.zMin} | ${x.th.kappa} | ${f(x.r.drift3.DRIFT)} | ${f(x.r.drift5.DRIFT)} | ${f(x.r.stable.notDrift)} | ${f(x.r.stable_sA5.notDrift)} | ${f(x.r.outlier15.DRIFT)} | ${f(x.r.jump8.DRIFT)} | ${x.ok ? "نعم" : "لا"} |`);
}
console.log(out.join("\n"));
