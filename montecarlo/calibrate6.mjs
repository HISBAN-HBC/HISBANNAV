// calibrate6.mjs — شبكة (τ_O, τ_t) لإحصاءة الشذوذ المركّبة:
//   OUTLIER_i ⇔ O_i > τ_O  و |t_i| > τ_t  و D₋ᵢ < 2
import { readFileSync } from "node:fs";
const TO = [5, 10, 15, 20, 30];
const TT = [0, 2, 2.5, 3, 3.5, 4];
const f = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "—");
const isOut = (recs, tO, tT) => recs.map((r) => r.ps.some((p) => p.O > tO && Math.abs(p.t) > tT && p.D < 2));
const rate = (recs, tO, tT) => isOut(recs, tO, tT).filter(Boolean).length / recs.length;
const lines = [];
for (const N of [5, 9]) {
  const d = JSON.parse(readFileSync(new URL(`./f6-N${N}.json`, import.meta.url), "utf8"));
  const by = Object.fromEntries(d.out.map((s) => [s.key, s.recs]));
  lines.push(`\n## N=${N}`);
  lines.push("| τ_O | τ_t | Stable FA | Drift3 FA | Drift5 FA | Outlier10 | Outlier15 | Outlier20 | Jump8 FA | Jump12 FA | مجموع الانتهاكات |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  let best = null;
  for (const tO of TO) for (const tT of TT) {
    const st = rate(by.stable, tO, tT), d3 = rate(by.drift3, tO, tT), d5 = rate(by.drift5, tO, tT);
    const o10 = rate(by.outlier10, tO, tT), o15 = rate(by.outlier15, tO, tT), o20 = rate(by.outlier20, tO, tT);
    const j8 = rate(by.jump8_mid, tO, tT), j12 = rate(by.jump12_mid, tO, tT);
    const viol = Math.max(0, st - 0.03) + Math.max(0, d3 - 0.05) + Math.max(0, 0.85 - o15);
    lines.push(`| ${tO} | ${tT} | ${f(st)} | ${f(d3)} | ${f(d5)} | ${f(o10)} | ${f(o15)} | ${f(o20)} | ${f(j8)} | ${f(j12)} | ${viol.toFixed(3)} |`);
    if (!best || viol < best.viol) best = { tO, tT, viol, st, d3, o15 };
  }
  lines.push(`أفضل نقطة (هدف: FA≤3%، Drift3 FA≤5%، Outlier≥85%): τ_O=${best.tO}، τ_t=${best.tT}، مجموع=${best.viol.toFixed(3)}`);
}
console.log(lines.join("\n"));
