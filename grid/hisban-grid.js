// hisban-grid.js
// شبكة الخلايا المرجعية (HGRD). تخزن فقط مراكز الخلايا، والتوقيع الفلكي يُحسب عند الطلب.

/**
 * مراكز خلايا متساوية الدرجات تغطي الكرة الأرضية.
 * size = 5 يعطي 36 × 72 = 2592 خلية.
 */
export function cellCenters(sizeDeg = 5) {
  const rows = Math.round(180 / sizeDeg);
  const cols = Math.round(360 / sizeDeg);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const lat = -90 + sizeDeg / 2 + i * sizeDeg;
    for (let j = 0; j < cols; j++) {
      const lon = -180 + sizeDeg / 2 + j * sizeDeg;
      out.push({ lat, lon });
    }
  }
  return out;
}

/** فهرس الخلية التي تحوي نقطة معينة في شبكة بحجم معين */
export function cellIndexOf(lat, lon, sizeDeg = 5) {
  const cols = Math.round(360 / sizeDeg);
  const rows = Math.round(180 / sizeDeg);
  const i = Math.min(rows - 1, Math.max(0, Math.floor((lat + 90) / sizeDeg)));
  const j = ((Math.floor((lon + 180) / sizeDeg) % cols) + cols) % cols;
  return i * cols + j;
}
