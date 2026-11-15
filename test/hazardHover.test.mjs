import test from 'node:test'
import assert from 'node:assert/strict'
import { ObservationStore } from '../src/core/data/observationStore.js'
import { LayerRegistry, DEFAULT_LAYERS } from '../src/core/layers/layerRegistry.js'
import { normalizeEonet } from '../src/data/hazards.js'
import { hazardItemsForIds } from '../src/data/hazardHover.js'

const eonet = { events: [
  { id: 'EONET_1', title: 'Flood in Sylhet, Bangladesh', link: 'https://x', closed: null, sources: [], geometry: [{ date: '2026-07-11T00:00:00Z', type: 'Point', coordinates: [91.8, 24.9] }] },
  { id: 'EONET_2', title: 'Flood in Kerala', closed: '2026-08-02T00:00:00Z', geometry: [{ date: '2026-07-20T00:00:00Z', type: 'Point', coordinates: [76.3, 9.9] }] },
] }

test('store.find resolves ids across layers', () => {
  const store = new ObservationStore(); const obs = normalizeEonet(eonet, 'floods'); store.add('floods', obs)
  assert.equal(store.find(obs[0].id).layerId, 'floods'); assert.equal(store.find('nope'), null)
})
test('hover items: flood details, ongoing vs closed, ignores non-hazard ids', () => {
  const store = new ObservationStore(); const reg = new LayerRegistry(DEFAULT_LAYERS)
  const obs = normalizeEonet(eonet, 'floods'); store.add('floods', obs)
  const items = hazardItemsForIds([obs[0].id, obs[1].id, 'some-footprint-id', { not: 'string' }], store, reg)
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'Flood event'); assert.equal(items[0].title, 'Flood in Sylhet, Bangladesh')
  assert.equal(items[0].ongoing, true); assert.equal(items[0].when, '2026-07-11'); assert.deepEqual(items[0].center, [91.8, 24.9])
  assert.equal(items[1].ongoing, false); assert.equal(items[1].closed, '2026-08-02')
  assert.equal(items[0].color, '#1e90ff')
})
