// replay.js — ReplaySolarProvider: يقرأ جلسة research/ ويعيد قياساتها بالتسلسل نفسه تماماً.
// الهدف: إعادة تشغيل جلسة هاتف حقيقية حرفياً داخل المختبر.
// ملاحظة: الجلسة الحالية (schema v1) تخزّن قياسات الشمس المجمّعة، لا القراءات الخام للحساسات.
// إعادة تشغيل القراءات الخام تحتاج schema v2 (انظر الملاحظات في التسليم).
import { SensorProvider } from "./base.js";
import { unavailable } from "./contracts.js";

export class ReplaySolarProvider extends SensorProvider {
  /** @param {object} session جلسة بصيغة research/ (حقل measurements مطلوب) */
  constructor(session) {
    super("ReplaySolar");
    if (!session || !Array.isArray(session.measurements)) {
      throw new Error("ReplaySolarProvider: session.measurements must be an array");
    }
    this.sessionId = session.sessionId ?? null;
    this._items = session.measurements.map((m) => Object.freeze({ ...m }));
    this._i = 0;
  }
  /** تعيد القياس التالي بالتسلسل المسجَّل، أو سبباً صريحاً عند النهاية. */
  read() {
    if (this._i >= this._items.length) return unavailable("END_OF_SESSION");
    const measurement = this._items[this._i++];
    return { timestampUtc: measurement.timestampUtc, available: true, measurement };
  }
  reset() {
    this._i = 0;
  }
  get position() {
    return this._i;
  }
  get length() {
    return this._items.length;
  }
}
