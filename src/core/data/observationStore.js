// ObservationStore — holds normalized observations per layer and answers windowed/spatial queries.
// The map and UI use only this interface, so a remote provider (ASF/CMR with paging, tiles or aggregation)
// can later replace the in-memory implementation without touching rendering code.
import { assertObservation, inWindow } from './schema.js';

export class ObservationStore {
  constructor() { this._byLayer = new Map(); this._subs = new Set(); }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit(layerId) { for (const fn of this._subs) fn(layerId); }
  /** adapter.normalize() output goes in; every record is validated. Replaces by id (idempotent re-import). */
  add(layerId, observations) {
    const m = this._byLayer.get(layerId) ?? new Map();
    for (const o of observations) { assertObservation(o); m.set(o.id, o); }
    this._byLayer.set(layerId, m); this._emit(layerId);
  }
  clear(layerId) { this._byLayer.delete(layerId); this._emit(layerId); }
  count(layerId) { return this._byLayer.get(layerId)?.size ?? 0; }
  /** @param {{layerId:string, window?:{start:number,end:number}, limit?:number, offset?:number}} q */
  query({ layerId, window: win, limit = 2000, offset = 0 }) {
    const all = [...(this._byLayer.get(layerId)?.values() ?? [])];
    const hit = win ? all.filter((f) => inWindow(f, win)) : all;
    hit.sort((a, b) => a.properties.timestamp.localeCompare(b.properties.timestamp));
    return { total: hit.length, features: hit.slice(offset, offset + limit), nextOffset: offset + limit < hit.length ? offset + limit : null };
  }
  /** Look up one observation by id across all layers; returns {layerId, feature} or null. */
  find(id) { for (const [layerId, m] of this._byLayer) { const feature = m.get(id); if (feature) return { layerId, feature }; } return null; }
  /** Time extent of a layer's loaded data (ms) or null if empty. */
  extent(layerId) {
    const m = this._byLayer.get(layerId); if (!m?.size) return null;
    let lo = Infinity, hi = -Infinity;
    for (const f of m.values()) { const a = Date.parse(f.properties.timestamp); lo = Math.min(lo, a); hi = Math.max(hi, f.properties.endTimestamp ? Date.parse(f.properties.endTimestamp) : a); }
    return { start: lo, end: hi };
  }
}
