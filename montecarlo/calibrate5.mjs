// calibrate5.mjs — المصنف النهائي المقترح (حالات الوثيقة):
//   OUTLIER > DRIFT (M1 يفضَّل بوضوح) > JUMP_SUSPECT (G0>τ ولم يُفسَّر بالميل) > STABLE (M0 يفضَّل) > SUSPECT
// الهدف يشمل المستقر STABLE صراحة. τ_G0 مُعايَر على لا-قفزة وغير-شاذ عند P≤1%.
import { readFileSync, readdirSync } from "node:fs";
const files = readdirSync(new URL("./", import.meta.url)).filter((f) => /^f5-[AB]-N\d+\.json$/.test(f)).sort();
// τ_G0 يُعايَر على المستقر فقط: G0 يستجيب للانحراف بالتصميم، والانحراف يُحسم قبله بقاعدة DRIFT
const NO_JUMP = ["stable"];
const TO = [10, 20, 30];
const TM = [0, 2, 4, 6, 8];
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const f = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "—");
const aicc = (chi, k, n) => chi + 2 * k + (2 * k * (k + 1)) / (n - k - 1);

function decide(r, th) {
  if (r.Omax > th.tO && r.Dminus < 2) return "OUTLIER";
  const n = 2 * r.N;
  const a0 = aicc(r.chi0, 3, n), a1 = aicc(r.chi1, 4, n);
  if (a1 < a0 - th.tM) return "DRIFT";
  if (r.G0max > th.tG) return "JUMP_SUSPECT";
  // STABLE: لا تفضيل للميل، ولا قفزة، ولا اتجاه متبقٍ في البواقي (D<2)
  if (r.D < 2) return "STABLE";
  return "SUSPECT";
}

const sumRows = [];
const jumpRows = [];
const tradeRows = [];
for (const file of files) {
  const d = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const by = Object.fromEntries(d.out.map((s) => [s.key, s]));
  const rate = (k, lab, th) => by[k].recs.filter((r) => decide(r, th) === lab).length / by[k].recs.length;
  let best = null;
  for (const tO of TO) for (const tM of TM) {
    const nullG = NO_JUMP.flatMap((k) => by[k].recs).filter((r) => !(r.Omax > tO && r.Dminus < 2)).map((r) => r.G0max);
    const tG = pctl(nullG, 0.99);
    const th = { tO, tM, tG };
    const t = {
      stableSTABLE: rate("stable", "STABLE", th),
      stableJumpFA: rate("stable", "JUMP_SUSPECT", th),
      driftJumpFA: Math.max(...["drift1", "drift2", "drift3", "drift5"].map((k) => rate(k, "JUMP_SUSPECT", th))),
      outlierOK: rate("outlier15", "OUTLIER", th),
      stableOutlierFA: rate("stable", "OUTLIER", th),
      drift3DRIFT: rate("drift3", "DRIFT", th),
      drift5DRIFT: rate("drift5", "DRIFT", th),
    };
    const viol = Math.max(0, 0.95 - t.stableSTABLE) + Math.max(0, t.stableJumpFA - 0.05) + Math.max(0, t.driftJumpFA - 0.05) +
      Math.max(0, 0.8 - t.outlierOK) + Math.max(0, t.stableOutlierFA - 0.05) + Math.max(0, 0.9 - t.drift3DRIFT) + Math.max(0, 0.9 - t.drift5DRIFT);
    const row = { th, t, viol };
    tradeRows.push({ file: d.DESIGN + d.N, ...row });
    if (!best || viol < best.viol) best = row;
  }
  const { th, t } = best;
  sumRows.push({ d, th, t, viol: best.viol });
  for (const k of ["stable", "drift3", "drift5", "outlier15", "jump4_mid", "jump8_mid", "jump12_mid"]) {
    const c = by[k].recs.map((r) => decide(r, th)).reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
    const n = by[k].recs.length;
    jumpRows.push({ design: d.DESIGN, N: d.N, k, c, n });
  }
}

const out = [];
out.push("## الحدود المختارة (أهداف صريحة شاملة للمستقر STABLE)");
out.push("| التصميم | N | النافذة | tO | tM | τ_G0 | Stable→STABLE | Stable→JUMP_SUSPECT | Drift→JUMP_SUSPECT | Stable→OUTLIER | Outlier→OUTLIER | Drift3→DRIFT | Drift5→DRIFT | مجموع الانتهاكات |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of sumRows) {
  const span = ((s.d.off[s.d.off.length - 1] - s.d.off[0]) / 60).toFixed(0);
  out.push(`| ${s.d.DESIGN} | ${s.d.N} | ${span}h | ${s.th.tO} | ${s.th.tM} | ${s.th.tG.toFixed(1)} | ${f(s.t.stableSTABLE)} | ${f(s.t.stableJumpFA)} | ${f(s.t.driftJumpFA)} | ${f(s.t.stableOutlierFA)} | ${f(s.t.outlierOK)} | ${f(s.t.drift3DRIFT)} | ${f(s.t.drift5DRIFT)} | ${s.viol.toFixed(3)} |`);
}
out.push("\n(σ_A=5 لا يدخل الهدف: هو خطأ نموذج مُعلَن، يُعرض في الجدول أدناه كحالة مستقلة)");
out.push("\n## توزيع الحالات لكل سيناريو (بالحدود المختارة)");
const states = ["STABLE", "SUSPECT", "DRIFT", "JUMP_SUSPECT", "OUTLIER"];
out.push(`| التصميم | N | السيناريو | ${states.join(" | ")} |`);
out.push(`|---|---|---|${states.map(() => "---").join("|")}|`);
for (const r of jumpRows) out.push(`| ${r.design} | ${r.N} | ${r.k} | ${states.map((s) => f((r.c[s] || 0) / r.n)).join(" | ")} |`);
console.log(out.join("\n"));
if (process.env.TRADE) {
  const lines = ["\n## منحنى المقايضة (A، N=9)", "| tO | tM | Stable→STABLE | Stable→OUTLIER | Outlier→OUTLIER | Drift3→DRIFT | مجموع |", "|---|---|---|---|---|---|---|"];
  for (const r of tradeRows.filter((x) => x.file === "A9")) lines.push(`| ${r.th.tO} | ${r.th.tM} | ${f(r.t.stableSTABLE)} | ${f(r.t.stableOutlierFA)} | ${f(r.t.outlierOK)} | ${f(r.t.drift3DRIFT)} | ${r.viol.toFixed(3)} |`);
  console.log(lines.join("\n"));
}
