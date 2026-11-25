// calibrate3.mjs — معايرة τ_J من توزيع Δ_J تحت "لا قفزة" (P ≤ 1%)، ثم جدول N×تصميم.
// الترتيب: OUTLIER (drop-one) > JUMP (Δ_J > τ_J) > AICc(M0 مقابل M1، k=3,4) > SUSPECT
import { readFileSync, readdirSync } from "node:fs";
const files = readdirSync(new URL("./", import.meta.url)).filter((f) => /^f3-[AB]-N\d+\.json$/.test(f)).sort();
const NO_JUMP = new Set(["stable", "stable_sA5", "drift1", "drift2", "drift3", "drift5", "outlier15"]);
const TM = [0, 2, 4];
const TO = [10, 20];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const f = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "—");
const aicc = (chi, k, n) => chi + 2 * k + (2 * k * (k + 1)) / (n - k - 1);

function classify(r, th) {
  if (r.Omax > th.tO && r.Dminus < 2) return "OUTLIER";
  if (r.dJ > th.tJ) return "JUMP";
  const n = 2 * r.N;
  const a0 = aicc(r.chi0, 3, n), a1 = aicc(r.chi1, 4, n);
  const margin = Math.abs(a0 - a1);
  if (margin < th.tM) return "SUSPECT";
  return a0 < a1 ? "STABLE" : "DRIFT";
}

const report = [];
const sweepReport = [];
for (const file of files) {
  const d = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const byKey = Object.fromEntries(d.out.map((s) => [s.key, s]));
  const noJump = d.out.filter((s) => NO_JUMP.has(s.key)).flatMap((s) => s.recs.map((r) => r.dJ));
  const tJ = pct(noJump, 0.99);
  // اختيار tO و tM بتقليل الانتهاكات
  let best = null;
  for (const tO of TO) for (const tM of TM) {
    const th = { tJ, tO, tM };
    const c = {};
    for (const s of d.out) if (!s.sweep) c[s.key] = s.recs.map((r) => classify(r, th)).reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
    const rate = (k, lab) => ((c[k] && c[k][lab]) || 0) / byKey[k].recs.length;
    const viol = Math.max(0, 0.95 - rate("stable", "STABLE")) + Math.max(0, 0.95 - rate("drift3", "DRIFT")) +
      Math.max(0, rate("stable", "JUMP") - 0.05) + Math.max(0, rate("drift3", "JUMP") - 0.05) +
      Math.max(0, 0.8 - rate("jump8_mid", "JUMP")) + Math.max(0, 0.95 - rate("jump12_mid", "JUMP"));
    if (!best || viol < best.viol) best = { th, viol, c };
  }
  const { th, c } = best;
  const rate = (k, lab) => ((c[k] && c[k][lab]) || 0) / byKey[k].recs.length;
  const locOk = (k) => {
    const js = byKey[k].recs.filter((r) => classify(r, th) === "JUMP");
    return js.length ? js.filter((r) => Math.abs(r.cHat - r.cTrue) <= 1).length / js.length : NaN;
  };
  report.push({ file, N: d.N, design: d.DESIGN, off: d.off, tJ: th.tJ, tO: th.tO, tM: th.tM,
    stableJ: rate("stable", "JUMP"), drift3J: rate("drift3", "JUMP"),
    j8: rate("jump8_mid", "JUMP"), j12: rate("jump12_mid", "JUMP"),
    loc8: locOk("jump8_mid"), loc12: locOk("jump12_mid"), stableOK: rate("stable", "STABLE"), drift3OK: rate("drift3", "DRIFT"),
    outOK: rate("outlier15", "OUTLIER") });
  for (const s of d.out.filter((x) => x.sweep)) {
    const js = s.recs.filter((r) => classify(r, th) === "JUMP");
    sweepReport.push({ N: d.N, design: d.DESIGN, key: s.key,
      pJ: js.length / s.recs.length,
      loc: js.length ? js.filter((r) => Math.abs(r.cHat - r.cTrue) <= 1).length / js.length : NaN });
  }
}

const out = [];
out.push("## الجدول الرئيسي (τ_J معايَر من توزيع Δ_J تحت لا-قفزة، P≤1%)");
out.push("| التصميم | N | النافذة | τ_J | Stable→JUMP | Drift3→JUMP | Jump8→JUMP | Jump12→JUMP | ĉ±1 (8°) | ĉ±1 (12°) | Stable→STABLE | Drift3→DRIFT | Outlier→OUTLIER |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of report) {
  const span = ((r.off[r.off.length - 1] - r.off[0]) / 60).toFixed(0);
  out.push(`| ${r.design} | ${r.N} | ${span}h | ${r.tJ.toFixed(2)} | ${f(r.stableJ)} | ${f(r.drift3J)} | ${f(r.j8)} | ${f(r.j12)} | ${f(r.loc8)} | ${f(r.loc12)} | ${f(r.stableOK)} | ${f(r.drift3OK)} | ${f(r.outOK)} |`);
}
out.push("\n## مسح موقع القفزة (P(JUMP) و P(|ĉ−c|≤1) | JUMP)");
out.push("| التصميم | N | السيناريو | P(JUMP) | P(|ĉ−c|≤1) |");
out.push("|---|---|---|---|---|");
for (const r of sweepReport) out.push(`| ${r.design} | ${r.N} | ${r.key} | ${f(r.pJ)} | ${f(r.loc)} |`);
console.log(out.join("\n"));
