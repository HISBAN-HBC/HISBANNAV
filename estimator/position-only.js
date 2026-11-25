// position-only.js — وضع Position-only: الانحياز مُثبَّت عند صفر ولا يُقدَّر.
// هذا ليس "حالة حساس"، بل طريقة تقدير. الحالة تُوصَف بمصنف الحالات منفصلاً.

import { estimateJoint } from "./joint.js";

export function estimatePositionOnly(meas, opts = {}) {
  const res = estimateJoint(meas, { ...opts, fixB: 0 });
  return { mode: "POSITION_ONLY", ...res };
}
