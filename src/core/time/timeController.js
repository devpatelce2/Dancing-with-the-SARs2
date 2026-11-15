// TimelineController — UTC time state + playback. Framework-free; knows nothing about layers or datasets.
// Consumers subscribe to changes; time-dependent layers read `getWindow()` to filter their data.
export const STEPS = { '1 h': 3600e3, '6 h': 6 * 3600e3, '1 day': 86400e3, '7 days': 7 * 86400e3, '30 days': 30 * 86400e3 };
// Playback speed = simulated time advanced per real second.
export const SPEEDS = { '1 min/s': 60e3, '1 h/s': 3600e3, '6 h/s': 6 * 3600e3, '1 day/s': 86400e3, '7 days/s': 7 * 86400e3 };

export class TimelineController {
  constructor({ now = Date.now(), start = now - 90 * 86400e3, end = now, windowMs = 86400e3,
                speedMsPerSec = 86400e3, schedule = (fn) => requestAnimationFrame(fn), cancel = (id) => cancelAnimationFrame(id),
                clock = () => performance.now() } = {}) {
    this.state = { time: now, start, end, windowMs, speedMsPerSec, direction: 1, playing: false };
    this._subs = new Set(); this._schedule = schedule; this._cancel = cancel; this._clock = clock;
    this._raf = null; this._last = 0;
  }
  getState() { return this.state; }
  /** Half-open UTC interval [start, end) that time-aware layers should display. Centred on the selected time's trailing window. */
  getWindow() { const { time, windowMs } = this.state; return { start: time - windowMs, end: time }; }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const fn of this._subs) fn(this.state); }
  _set(patch) { this.state = { ...this.state, ...patch }; this._emit(); }
  setTime(ms) { const { start, end } = this.state; this._set({ time: Math.min(end, Math.max(start, ms)) }); }
  setRange(start, end) { if (start >= end) return; this._set({ start, end, time: Math.min(end, Math.max(start, this.state.time)) }); }
  setWindow(ms) { this._set({ windowMs: Math.max(60e3, ms) }); }
  setSpeed(msPerSec) { this._set({ speedMsPerSec: msPerSec }); }
  setDirection(dir) { this._set({ direction: dir < 0 ? -1 : 1 }); }
  step(deltaMs) { this.setTime(this.state.time + deltaMs); }
  play() {
    if (this.state.playing) return;
    const { time, start, end, direction } = this.state;
    if (direction > 0 && time >= end) this.setTime(start); else if (direction < 0 && time <= start) this.setTime(end);
    this._last = this._clock(); this._set({ playing: true }); this._raf = this._schedule(this._tick);
  }
  pause() { if (!this.state.playing) return; if (this._raf != null) this._cancel(this._raf); this._raf = null; this._set({ playing: false }); }
  toggle() { this.state.playing ? this.pause() : this.play(); }
  _tick = () => {
    if (!this.state.playing) return;
    const now = this._clock(); const dt = Math.min(250, now - this._last); this._last = now;
    const { time, start, end, direction, speedMsPerSec } = this.state;
    const next = time + direction * speedMsPerSec * (dt / 1000);
    if (next >= end || next <= start) { this._set({ time: next >= end ? end : start }); this.pause(); return; }
    this._set({ time: next }); this._raf = this._schedule(this._tick);
  };
}
