// LayerRegistry — single source of truth for layer metadata and visibility.
// Renderers (map layers) and UI both subscribe; neither knows about the other.
/** @typedef {'integrated'|'test'|'future'} LayerStatus
 *  integrated: backed by verified source data. test: user-supplied/test data, not verified.
 *  future: registered and toggleable, but no data source connected (never shows data). */
export class LayerRegistry {
  constructor(defs = []) { this._layers = new Map(); this._subs = new Set(); defs.forEach((d) => this.register(d)); }
  register(def) {
    if (this._layers.has(def.id)) throw new Error(`Layer already registered: ${def.id}`);
    this._layers.set(def.id, { visible: false, status: 'future', timeAware: false, ...def }); this._emit();
  }
  get(id) { return this._layers.get(id); }
  list(group) { const all = [...this._layers.values()]; return group ? all.filter((l) => l.group === group) : all; }
  setVisible(id, visible) { const l = this._layers.get(id); if (l && l.visible !== visible) { l.visible = visible; this._version++; this._emit(); } }
  toggle(id) { const l = this._layers.get(id); if (l) this.setVisible(id, !l.visible); }
  setStatus(id, status) { const l = this._layers.get(id); if (l) { l.status = status; this._version++; this._emit(); } }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _version = 0;
  getVersion() { return this._version; }
  _emit() { this._version++; for (const fn of this._subs) fn(this); }
}

export const DEFAULT_LAYERS = [
  // group "map": basemap furniture
  { id: 'labels', group: 'map', label: 'Geographic labels', visible: true, status: 'integrated', attribution: 'Natural Earth' },
  { id: 'boundaries', group: 'map', label: 'Country boundaries', visible: true, status: 'integrated', attribution: 'Natural Earth' },
  { id: 'daynight', group: 'map', label: 'Day / night', visible: true, status: 'integrated', attribution: 'NOAA solar algorithm' },
  // group "satellite": no data shipped; footprints appear only after real metadata is imported
  { id: 'sentinel1', group: 'satellite', label: 'Sentinel-1', mission: 'SENTINEL-1', timeAware: true, color: '#4cc9f0', attribution: 'ESA / Copernicus via ASF DAAC' },
  { id: 'nisar', group: 'satellite', label: 'NISAR', mission: 'NISAR', timeAware: true, color: '#f9c74f', attribution: 'NASA-ISRO via ASF DAAC' },
  // group "disaster": registered only
  ...[['floods', 'Floods', '#1e90ff'], ['earthquakes', 'Earthquakes (M4.5+)', '#ff006e'], ['wildfires', 'Wildfires', '#fb5607'], ['cyclones', 'Severe storms / cyclones', '#8338ff'],
      ['volcanoes', 'Volcanic activity', '#d62828'], ['landslides', 'Landslides', '#a0522d'], ['droughts', 'Droughts', '#e9c46a']]
    .map(([id, label, color]) => ({ id, group: 'disaster', label, color, timeAware: true, category: id })),
];
