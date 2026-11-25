// write-golden.mjs — يكتب الملف الذهبي من المرجع المتحقَّق منه (المختبر والمنتج متطابقان حالياً).
import { writeFileSync } from "node:fs";
import { runParity } from "./parity.mjs";
const rows = runParity();
const bad = rows.filter((r) => r.fails.length);
if (bad.length) { console.error("refusing to write golden: parity failing for", bad.map((r) => r.id)); process.exit(1); }
const golden = {
  generatedBy: "write-golden.mjs",
  tolerances: { phiDeg: 1e-6, lamDeg: 1e-6, biasDeg: 1e-5, chi2Abs: 1e-9, chi2Rel: 1e-9, hRel: 1e-9 },
  scenarios: rows.filter((r) => r.labCompatible).map((r) => ({
    id: r.id,
    joint: r.checks.joint.prod,
    positionOnly: r.checks.positionOnly.prod,
  })),
};
writeFileSync(new URL("./parity-golden.json", import.meta.url), JSON.stringify(golden, null, 2) + "\n");
console.log(`golden written: ${golden.scenarios.length} scenarios`);
