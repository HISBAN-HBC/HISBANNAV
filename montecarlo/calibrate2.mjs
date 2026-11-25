// calibrate2.mjs — حالات: OUTLIER > UNOBSERVABLE > (AICc: STABLE/DRIFT/JUMP بفوز واضح) > SUSPECT
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("./features2.json", import.meta.url), "utf8"));
const GRID = { tO: [10, 20, 30], tU: [4, 6, 10], tM: [0, 2, 4, 6, 8] };
const N_ = 5;
function aicc(chi, k) { const n = 2 * N_; return chi + 2 * k + (2 * k * (k + 1)) / (n - k - 1); }
function classify(f, th) {
  if (f.Omax > th.tO && f.Dminus < 2) return "OUTLIER";
  if (f.sigB0 > th.tU) return "UNOBSERVABLE";
  const a = { STABLE: aicc(f.chi0, 3), DRIFT: aicc(f.chi1, 4), JUMP: aicc(f.chi2, Number(process.env.KM2 ?? 5)) };
  const order = Object.entries(a).sort((x, y) => x[1] - y[1]);
  if (order[1][1] - order[0][1] < th.tM) return "SUSPECT";
  return order[0][0];
}
const frac = (arr, p) => arr.filter(p).length / arr.length;
function scoreRow(s, th) {
  return { st: s.recs.map((f) => classify(f, th)) };
}
function score(th) {
  const per = {};
  for (const s of data.out) {
    const st = s.recs.map((f) => classify(f, th));
    per[s.key] = { n: st.length, cnt: st.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {}) };
  }
  const r = (k, lab) => (per[k].cnt[lab] || 0) / per[k].n;
  const viol =
    Math.max(0, 0.95 - r("stable", "STABLE")) + Math.max(0, 0.95 - r("stable_sA5", "STABLE")) +
    Math.max(0, 0.95 - r("drift3", "DRIFT")) + Math.max(0, 0.95 - r("drift5", "DRIFT")) +
    Math.max(0, r("outlier15", "DRIFT") + r("outlier15", "JUMP") - 0.05) +
    ["jump4_mid", "jump8_mid", "jump12_mid", "jump8_late", "jump12_late"].reduce((s, k) => s + Math.max(0, r(k, "DRIFT") - 0.05), 0);
  return { per, viol };
}

const res = [];
for (const tO of GRID.tO) for (const tU of GRID.tU) for (const tM of GRID.tM) {
  const th = { tO, tU, tM };
  res.push({ th, ...score(th) });
}
res.sort((a, b) => a.viol - b.viol);
const pick = res[0];
const f = (x) => (x * 100).toFixed(1) + "%";
const labels = ["STABLE", "SUSPECT", "DRIFT", "JUMP", "OUTLIER", "UNOBSERVABLE"];
const out = [];
out.push(`أقل مجموع انتهاكات: ${pick.viol.toFixed(3)}  (tO=${pick.th.tO}، tU=${pick.th.tU}، tM=${pick.th.tM})`);
out.push("\n## مصفوفة الارتباك للحدود المختارة");
out.push(`| الحالة الحقيقية | ${labels.join(" | ")} |`);
out.push(`|---|${labels.map(() => "---").join("|")}|`);
for (const s of data.out) {
  const c = pick.per[s.key];
  out.push(`| ${s.key} | ${labels.map((l) => f((c.cnt[l] || 0) / c.n)).join(" | ")} |`);
}
out.push("\n## دقة تحديد موقع القفزة (للتجارب المصنفة JUMP)");
out.push("| السيناريو | نسبة JUMP | P(\\|ĉ−c\\|≤1) | ĉ = c الصحيح |");
out.push("|---|---|---|---|");
for (const s of data.out.filter((x) => x.recs[0].cTrue !== null)) {
  const recs = s.recs.filter((x) => classify(x, pick.th) === "JUMP");
  const nJ = (pick.per[s.key].cnt.JUMP || 0) / s.recs.length;
  const loc = recs.length ? frac(recs, (x) => Math.abs(x.cHat - x.cTrue) <= 1) : NaN;
  const exact = recs.length ? frac(recs, (x) => x.cHat === x.cTrue) : NaN;
  out.push(`| ${s.key} | ${f(nJ)} | ${Number.isFinite(loc) ? f(loc) : "—"} | ${Number.isFinite(exact) ? f(exact) : "—"} |`);
}
out.push("\n## أفضل 6 نقاط حدود");
out.push("| tO | tU | tM | مجموع الانتهاكات |");
out.push("|---|---|---|---|");
for (const x of res.slice(0, 6)) out.push(`| ${x.th.tO} | ${x.th.tU} | ${x.th.tM} | ${x.viol.toFixed(3)} |`);
console.log(out.join("\n"));
