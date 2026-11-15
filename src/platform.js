// Composition root: builds the framework-free core objects once. React and the map attach to these;
// data adapters feed `store`; nothing here imports Cesium or React.
import { TimelineController } from './core/time/timeController.js';
import { LayerRegistry, DEFAULT_LAYERS } from './core/layers/layerRegistry.js';
import { ObservationStore } from './core/data/observationStore.js';
import { LocationInspector } from './core/inspector/locationInspector.js';
import { asfAdapter } from './core/data/adapters/asfAdapter.js';

export const ADAPTERS = [asfAdapter]; // register new source adapters here (order = detection priority)

export function createPlatform() {
  const timeline = new TimelineController({ now: Math.floor(Date.now() / 60000) * 60000, end: Math.floor(Date.now() / 60000) * 60000 });
  const registry = new LayerRegistry(DEFAULT_LAYERS);
  const store = new ObservationStore();
  const inspector = new LocationInspector({ store, registry, timeline });
  /** Import a user-supplied GeoJSON FeatureCollection (e.g. Vertex/asf_search export). Returns a report; nothing is fabricated. */
  function importGeoJSON(fc) {
    const adapter = ADAPTERS.find((a) => a.canHandle(fc));
    if (!adapter) throw new Error('No adapter recognises this GeoJSON (expected ASF/Vertex properties such as sceneName and startTime).');
    const { observations, skipped } = adapter.normalize(fc);
    const byLayer = {};
    for (const o of observations) (byLayer[o.properties.layerId] ??= []).push(o);
    for (const [layerId, obs] of Object.entries(byLayer)) {
      store.add(layerId, obs);
      registry.setStatus(layerId, 'test'); // user-supplied data is never labelled "integrated/verified" automatically
      registry.setVisible(layerId, true);
    }
    return { adapter: adapter.id, added: Object.fromEntries(Object.entries(byLayer).map(([k, v]) => [k, v.length])), skipped };
  }
  return { timeline, registry, store, inspector, importGeoJSON };
}
