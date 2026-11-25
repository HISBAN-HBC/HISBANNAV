// base.js — الواجهة المشتركة لكل مزوِّد حساس: read() تُعيد قراءة موحدة، ولا تُعيد أبداً بيانات مختلقة.

export class SensorProvider {
  constructor(name) {
    this.name = name;
  }
  /** يجب أن تُنفَّذ في الفئة الفرعية. */
  read() {
    throw new Error(`${this.name}.read() is not implemented`);
  }
}
