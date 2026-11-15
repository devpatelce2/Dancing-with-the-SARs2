import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUsgs, normalizeEonet } from '../src/data/hazards.js'
import { assertObservation } from '../src/core/data/schema.js'

test('USGS GeoJSON normalizes to valid observations', () => {
  const o = normalizeUsgs({ features: [{ id: 'us1', properties: { mag: 5.1, place: 'X', title: 'M 5.1 - X', time: Date.UTC(2026, 9, 1) }, geometry: { type: 'Point', coordinates: [10, 20, 33] } },
    { id: 'bad', properties: { mag: 4 }, geometry: { type: 'Point', coordinates: [0, 0] } }] })
  assert.equal(o.length, 1); assert.doesNotThrow(() => assertObservation(o[0])); assert.equal(o[0].properties.layerId, 'earthquakes')
})
test('EONET events keep every dated geometry and skip unusable ones', () => {
  const o = normalizeEonet({ events: [{ id: 'EONET_1', title: 'Fire A', link: 'l', sources: [], geometry: [
    { date: '2026-10-02T00:00:00Z', type: 'Point', coordinates: [1, 2] }, { date: '2026-10-03T00:00:00Z', type: 'Point', coordinates: [1.1, 2.1] }, { date: 'nope', type: 'Point', coordinates: [0, 0] }] }] }, 'wildfires')
  assert.equal(o.length, 2); o.forEach((x) => assert.doesNotThrow(() => assertObservation(x)))
})
