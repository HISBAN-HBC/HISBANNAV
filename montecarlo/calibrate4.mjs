// calibrate4.mjs — مصنف ثلاثي للقفزة مع G_max، وهدف OUTLIER صريح في دالة الاختيار.
// الحالات: OUTLIER > (G_max>τ_G ? JUMP | JUMP_SUSPECT حسب الميل) > (DRIFT/STABLE/SUSPECT للمحور الزمني)
import { readFileSync, readdirSync } from "node:fs";
const files = readdirSync(new URL("./", import.meta.url)).filter((f) => /^f4-[AB]-N\d+\.json$/.test(f)).sort();
const NO_JUMP = new Set(["stable", "stable_sA5", "drift1", "drift2", "drift3", "drift5", "outlier15"]);
const TO = [10, 20, 30];
const TM = [0, 2, 4, 6];
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const f = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "—");
const aicc = (chi, k, n) => chi + 2 * k + (2 * k * (k + 1)) / (n - k - 1);

// القرار الكامل لتجربة واحدة
function decide(r, th) {
  if (r.Omax > th.tO && r.Dminus < 2) return { jump: "NO_JUMP_EVIDENCE", axis: "OUTLIER" };
  const n = 2 * r.N;
  const a0 = aicc(r.chi0, 3, n), a1 = aicc(r.chi1, 4, n);
  const driftPref = a1 < a0 - th.tM;
  const stablePref = a0 < a1 - th.tM;
  let jump;
  if (r.Gmax > th.tG) jump = driftPref ? "JUMP_SUSPECT" : "JUMP";
  else jump = "NO_JUMP_EVIDENCE";
  const axis = driftPref ? "DRIFT" : stablePref ? "STABLE" : "SUSPECT";
  return { jump, axis };
}

const out = [];
const summaries = [];
for (const file of files) {
  const d = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const by = Object.fromEntries(d.out.map((s) => [s.key, s]));
  const scen = (k) => by[k].recs;
  let bestAll = null;
  const tradeoff = [];
  for (const tO of TO) for (const tM of TM) {
    // τ_G على تجارب "لا قفزة" التي لم يُعلن فيها OUTLIER
    const nullG = d.out.filter((s) => NO_JUMP.has(s.key)).flatMap((s) => s.recs)
      .filter((r) => !(r.Omax > tO && r.Dminus < 2)).map((r) => r.Gmax);
    const tG = pctl(nullG, 0.99);
    const th = { tO, tM, tG };
    const cnt = (k, pred) => scen(k).filter((r) => pred(decide(r, th))).length / scen(k).length;
    const rates = {
      stableFalseJump: cnt("stable", (x) => x.jump !== "NO_JUMP_EVIDENCE") / 1 ,
      stableFalseJump5: (cnt("stable_sA5", (x) => x.jump !== "NO_JUMP_EVIDENCE")),
      driftFalseJump: Math.max(...["drift1", "drift2", "drift3", "drift5"].map((k) => cnt(k, (x) => x.jump === "JUMP"))),
      outlierDetected: cnt("outlier15", (x) => x.axis === "OUTLIER"),
      drift3Drift: cnt("drift3", (x) => x.axis === "DRIFT"),
      drift5Drift: cnt("drift5", (x) => x.axis === "DRIFT"),
      stableStable: cnt("stable", (x) => x.axis === "STABLE"),
    };
    // أهداف: كل مقياس له حدّه؛ المجموع = الانتهاك الكلي
    const viol =
      Math.max(0, rates.stableFalseJump - 0.05) + Math.max(0, rates.stableFalseJump5 - 0.05) +
      Math.max(0, rates.driftFalseJump - 0.05) +
      Math.max(0, 0.8 - rates.outlierDetected) +
      Math.max(0, 0.9 - rates.drift3Drift) + Math.max(0, 0.9 - rates.drift5Drift);
    const row = { th, rates, viol };
    tradeoff.push(row);
    if (!bestAll || viol < bestAll.viol) bestAll = row;
  }
  const { th, rates } = bestAll;
  const jumpCases = (k) => scen(k).map((r) => decide(r, th).jump);
  const lab = (k) => {
    const L = jumpCases(k);
    return { JUMP: L.filter((x) => x === "JUMP").length / L.length, SUS: L.filter((x) => x === "JUMP_SUSPECT").length / L.length, NONE: L.filter((x) => x === "NO_JUMP_EVIDENCE").length / L.length };
  };
  const locAcc = (k) => {
    const rs = scen(k).filter((r) => r.cTrue !== null && decide(r, th).jump === "JUMP");
    return rs.length ? rs.filter((r) => Math.abs(r.cG - r.cTrue) <= 1).length / rs.length : NaN;
  };
  const span = ((d.off[d.off.length - 1] - d.off[0]) / 60).toFixed(0);
  summaries.push({ file, d, th, rates, lab, locAcc, span, tradeoff });
}

out.push("## الحدود المختارة لكل تصميم (دالة الهدف الصريحة)");
out.push("| التصميم | N | النافذة | tO | tM | τ_G | Stable false jump | Stable→STABLE | Sa5 false jump | Drift false JUMP | Outlier→OUTLIER | Drift3→DRIFT | Drift5→DRIFT | مجموع الانتهاكات |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of summaries) {
  const r = s.rates;
  out.push(`| ${s.d.DESIGN} | ${s.d.N} | ${s.span}h | ${s.th.tO} | ${s.th.tM} | ${s.th.tG.toFixed(1)} | ${f(r.stableFalseJump)} | ${f(r.stableStable)} | ${f(r.stableFalseJump5)} | ${f(r.driftFalseJump)} | ${f(r.outlierDetected)} | ${f(r.drift3Drift)} | ${f(r.drift5Drift)} | ${(s.tradeoff.find((t) => t.th === s.th) ?? s.tradeoff[0]).viol.toFixed(3)} |`);
}
out.push("\n## الحالة الثلاثية للقفزة (JUMP / JUMP_SUSPECT / NO_JUMP_EVIDENCE)");
out.push("| التصميم | N | السيناريو | JUMP | JUMP_SUSPECT | NO_JUMP | ĉ±1 (من JUMP) |");
out.push("|---|---|---|---|---|---|---|");
for (const s of summaries) for (const k of ["jump4_mid", "jump8_mid", "jump12_mid", "drift3", "stable"]) {
  const L = s.lab(k); const la = s.locAcc(k);
  out.push(`| ${s.d.DESIGN} | ${s.d.N} | ${k} | ${f(L.JUMP)} | ${f(L.SUS)} | ${f(L.NONE)} | ${Number.isFinite(la) ? f(la) : "—"} |`);
}
out.push("\n## مسح موقع القفزة: P(JUMP أو JUMP_SUSPECT)");
out.push("| التصميم | N | c | jump8 | jump12 | ĉ±1 (12°) |");
out.push("|---|---|---|---|---|---|");
for (const s of summaries) {
  for (let c = 1; c <= s.d.N - 1; c++) {
    const pick = (k) => { const rs = s.d.out.find((x) => x.key === k).recs.filter((r) => r.cTrue === c); return rs; };
    const p = (k) => { const rs = s.d.out.find((x) => x.key === `${k}_c${c}`).recs; return rs.filter((r) => decide(r, s.th).jump !== "NO_JUMP_EVIDENCE").length / rs.length; };
    const rs12 = s.d.out.find((x) => x.key === `jump12_c${c}`).recs.filter((r) => decide(r, s.th).jump === "JUMP");
    const loc = rs12.length ? rs12.filter((r) => Math.abs(r.cG - c) <= 1).length / rs12.length : NaN;
    out.push(`| ${s.d.DESIGN} | ${s.d.N} | ${c} | ${f(p("jump8"))} | ${f(p("jump12"))} | ${Number.isFinite(loc) ? f(loc) : "—"} |`);
  }
}
console.log(out.join("\n"));
