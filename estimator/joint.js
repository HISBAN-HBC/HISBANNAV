// joint.js — التقدير المشترك (φ, λ, b_A) بعدة بدايات من ترتيب الشبكة (HGRD).

import { cellCenters } from "../grid/hisban-grid.js";
import { rankCells } from "../matcher/hisban-matcher.js";
import { levenbergMarquardt, requireSigmas } from "./lm.js";

/** K = 10 بدايات، كما في المواصفة. */
export const DEFAULT_K = 10;
let cachedCells = null;
export function defaultCells() {
  if (!cachedCells) cachedCells = cellCenters(5);
  return cachedCells;
}

/**
 * تقدير مشترك. يعيد { best, runs } حيث runs مرتبة حسب χ².
 * يحتاج قياسين على الأقل (4 معادلات لثلاثة مجاهيل).
 */
export function estimateJoint(meas, { k = DEFAULT_K, cells = defaultCells(), fixB = null, priorSigmaB = null, bounds } = {}) {
  requireSigmas(meas);
  if (meas.length < 2) throw new Error("estimator: at least 2 measurements are required");
  const top = rankCells(cells, meas, k);
  const runs = top.map((c) => ({
    start: { lat: c.lat, lon: c.lon, chi2: c.chi2 },
    ...levenbergMarquardt([c.lat, c.lon, 0], meas, { fixB, priorSigmaB, bounds }),
  }));
  runs.sort((a, b) => a.chi2 - b.chi2);
  return { best: runs[0], runs };
}
