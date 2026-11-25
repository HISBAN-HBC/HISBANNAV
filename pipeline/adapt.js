// adapt.js — تحويل قياسات الشمس (بصيغة السجل) إلى الصيغة الداخلية للمُقدِّر والمطابِق.
export function toInternal(measurements) {
  return measurements.map((m) => ({
    utcMs: Date.parse(m.timestampUtc),
    altitudeDeg: m.solarAltitudeDeg,
    azimuthDeg: m.solarAzimuthDeg,
    sigmaAlt: m.sigmaAltitudeDeg,
    sigmaAz: m.sigmaAzimuthDeg,
  }));
}
