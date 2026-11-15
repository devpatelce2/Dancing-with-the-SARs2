// LocationInspector — answers "what is known about this point at this time?" from loaded reference geography and
// the observation store. Reports absence explicitly instead of implying coverage.
import { PolygonIndex, pointInGeometry } from '../geo/pointInPolygon.js';
import { loadCountries, loadMarine } from '../geo/geoData.js';

export class LocationInspector {
  constructor({ store, registry, timeline }) { this.store = store; this.registry = registry; this.timeline = timeline; this._ready = null; }
  _init() {
    this._ready ??= Promise.all([loadCountries(), loadMarine()]).then(([c, m]) => { this.countries = new PolygonIndex(c.features); this.marine = new PolygonIndex(m.features); });
    return this._ready;
  }
  async inspect(lon, lat) {
    await this._init();
    const hit = this.countries.find(lon, lat)[0]?.properties ?? null;
    const sea = this.marine.find(lon, lat).map((f) => f.properties.name);
    const win = this.timeline.getWindow();
    const layers = this.registry.list().filter((l) => l.group !== 'map');
    const perLayer = layers.map((l) => {
      const { features } = this.store.query({ layerId: l.id, window: win, limit: 5000 });
      const here = features.filter((f) => pointInGeometry(lon, lat, f.geometry) || (f.geometry.type === 'Point' && Math.hypot(f.geometry.coordinates[0] - lon, f.geometry.coordinates[1] - lat) < 0.25));
      return { layer: l, loaded: this.store.count(l.id), here };
    });
    return {
      lat, lon,
      name: hit ? hit.name : sea[0] ?? null,
      country: hit ? { name: hit.name, id: hit.id, iso2: hit.iso2, sovereign: hit.sovereign, type: hit.type } : null,
      region: hit ? [hit.subregion, hit.continent].filter(Boolean).join(' · ') : null,
      water: sea,
      satellite: perLayer.filter((p) => p.layer.group === 'satellite'),
      disaster: perLayer.filter((p) => p.layer.group === 'disaster'),
      window: win,
    };
  }
}
