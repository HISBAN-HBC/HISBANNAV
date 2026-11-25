// browser.js — مزوِّدات المتصفح (Chrome على Android). كل واجهة تُحقن من env حتى تُختبر دون هاتف.
// المبدأ: لا تُعاد بيانات مختلقة أبداً؛ أي عجز يظهر سبباً صريحاً.
import { SensorProvider } from "./base.js";
import { unavailable } from "./contracts.js";

const iso = (ms) => new Date(ms).toISOString();

/** يحوّل زمن الحساس (منذ أصل الصفحة) إلى زمن الجدار بالميلي ثانية. */
function wallMs(env, ts) {
  const origin = env.performance?.timeOrigin;
  return typeof origin === "number" && typeof ts === "number" ? origin + ts : (env.Date ?? Date).now();
}

/**
 * يحوّل عينة وضعية إلى قراءة IMU خام بصيغة الجلسة (v2).
 * المحاور الأخرى غير متاحة في هذا المسار، فتُسجَّل null صراحة.
 */
export function toRawImuRecord(sample) {
  return {
    timestampUtc: sample.timestampUtc,
    accelerometer: null,
    gyroscope: null,
    magnetometer: null,
    orientation: { quaternion: { ...sample.quaternion }, yawDeg: null, pitchDeg: null, rollDeg: null },
    available: true,
  };
}

/**
 * الوضعية المطلقة: AbsoluteOrientationSensor (quaternion بترتيب [x,y,z,w] في الواجهة).
 */
export class BrowserOrientationProvider extends SensorProvider {
  constructor(env = globalThis, { maxBuffer = 5000, frequency = 50 } = {}) {
    super("BrowserOrientation");
    this._env = env;
    this._max = maxBuffer;
    this._frequency = frequency;
    this._buf = [];
    this._sensor = null;
    this._status = "NOT_STARTED";
  }

  get supported() {
    return typeof this._env.AbsoluteOrientationSensor === "function";
  }

  get status() {
    return this._status;
  }

  start() {
    if (!this.supported) {
      this._status = "SENSOR_UNSUPPORTED";
      return false;
    }
    const s = new this._env.AbsoluteOrientationSensor({ frequency: this._frequency });
    s.addEventListener("reading", () => {
      const ms = wallMs(this._env, s.timestamp);
      const q = s.quaternion;
      this._buf.push({ tsMs: ms, timestampUtc: iso(ms), quaternion: { w: q[3], x: q[0], y: q[1], z: q[2] } });
      if (this._buf.length > this._max) this._buf.splice(0, this._buf.length - this._max);
      this._status = "OK";
    });
    s.addEventListener("error", (e) => {
      this._status = e.error?.name === "NotAllowedError" ? "PERMISSION_DENIED" : "SENSOR_ERROR";
    });
    this._sensor = s;
    this._status = "STARTING";
    s.start();
    return true;
  }

  stop() {
    this._sensor?.stop();
    this._sensor = null;
  }

  /** آخر عينة، أو سبب غير متاح صريح. */
  read() {
    if (!this.supported) return unavailable("SENSOR_UNSUPPORTED");
    if (this._status === "PERMISSION_DENIED" || this._status === "SENSOR_ERROR") return unavailable(this._status);
    const last = this._buf[this._buf.length - 1];
    if (!last) return unavailable(this._status === "NOT_STARTED" ? "NOT_STARTED" : "NO_SAMPLE_YET");
    return { timestampUtc: last.timestampUtc, quaternion: { ...last.quaternion }, available: true };
  }

  /** كل العينات بين زمنين (بالميلي ثانية، زمن الجدار)، بالترتيب الزمني. */
  samplesBetween(fromMs, toMs) {
    return this._buf
      .filter((s) => s.tsMs >= fromMs && s.tsMs <= toMs)
      .map((s) => ({ timestampUtc: s.timestampUtc, quaternion: { ...s.quaternion } }));
  }
}

/** GNSS: آخر موقع من watchPosition. يُستخدم كمرجع (truth) وليس في حساب الشمس. */
export class BrowserGnssProvider extends SensorProvider {
  constructor(env = globalThis) {
    super("BrowserGnss");
    this._env = env;
    this._last = null;
    this._id = null;
    this._status = "NOT_STARTED";
  }

  start() {
    const geo = this._env.navigator?.geolocation;
    if (!geo) {
      this._status = "SENSOR_UNSUPPORTED";
      return false;
    }
    this._status = "STARTING";
    this._id = geo.watchPosition(
      (p) => {
        const c = p.coords;
        this._last = {
          timestampUtc: iso(p.timestamp),
          latitudeDeg: c.latitude,
          longitudeDeg: c.longitude,
          altitudeM: Number.isFinite(c.altitude) ? c.altitude : null,
          accuracyM: c.accuracy,
          speedMps: Number.isFinite(c.speed) ? c.speed : null,
          bearingDeg: Number.isFinite(c.heading) ? c.heading : null,
          available: true,
        };
        this._status = "OK";
      },
      (err) => {
        this._status = err.code === 1 ? "PERMISSION_DENIED" : "GNSS_ERROR";
      },
      { enableHighAccuracy: true },
    );
    return true;
  }

  stop() {
    if (this._id !== null) this._env.navigator.geolocation.clearWatch(this._id);
    this._id = null;
  }

  read() {
    if (!this._env.navigator?.geolocation) return unavailable("SENSOR_UNSUPPORTED");
    if (this._last) return { ...this._last };
    return unavailable(this._status);
  }
}

/** الساعة: زمن الجدار من Date.now. */
export class BrowserClockProvider extends SensorProvider {
  constructor(env = globalThis) {
    super("BrowserClock");
    this._env = env;
  }
  read() {
    return { timestampUtc: iso((this._env.Date ?? Date).now()), source: "BROWSER_DATE", available: true };
  }
}
