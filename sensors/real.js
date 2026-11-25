// real.js — مزوِّدات الهاتف الحقيقية عبر المتصفح. الاختبار يمرّر env مزيفاً.
import { BrowserOrientationProvider, BrowserGnssProvider, BrowserClockProvider } from "./browser.js";

export function createRealSensors(env = globalThis) {
  return {
    orientation: new BrowserOrientationProvider(env),
    gnss: new BrowserGnssProvider(env),
    clock: new BrowserClockProvider(env),
  };
}
