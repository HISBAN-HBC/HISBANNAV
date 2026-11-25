// mock.js — مزوِّدات وهمية تقرأ من نص محدد مسبقاً. كل عنصر في النص قراءة موحدة (متاحة أو غير متاحة).
import { SensorProvider } from "./base.js";
import {
  validateCompassReading, validateImuReading, validateGnssReading, unavailable,
} from "./contracts.js";

class ScriptedProvider extends SensorProvider {
  constructor(name, script, validate) {
    super(name);
    this._validate = validate;
    this._script = script.map((r) => {
      const errors = validate(r);
      if (errors.length) throw new Error(`${name}: invalid scripted reading: ${errors.join("; ")}`);
      return Object.freeze({ ...r });
    });
    this._i = 0;
  }
  read() {
    if (this._i >= this._script.length) return unavailable("END_OF_SCRIPT");
    return this._script[this._i++];
  }
  reset() {
    this._i = 0;
  }
  get remaining() {
    return this._script.length - this._i;
  }
}

export class MockCompassProvider extends ScriptedProvider {
  constructor(script) { super("MockCompass", script, validateCompassReading); }
}
export class MockImuProvider extends ScriptedProvider {
  constructor(script) { super("MockImu", script, validateImuReading); }
}
export class MockGnssProvider extends ScriptedProvider {
  constructor(script) { super("MockGnss", script, validateGnssReading); }
}

/** ساعة وهمية: تعطي وقتاً يبدأ من startUtcMs ويتقدم بمقدار stepMs في كل قراءة. */
export class MockClockProvider extends SensorProvider {
  constructor({ startUtcMs, stepMs = 0 }) {
    super("MockClock");
    this._start = startUtcMs;
    this._step = stepMs;
    this._i = 0;
  }
  read() {
    const timestampUtc = new Date(this._start + this._i * this._step).toISOString();
    this._i++;
    return { timestampUtc, source: "MOCK", available: true };
  }
  reset() {
    this._i = 0;
  }
}
