import test from 'node:test'
import assert from 'node:assert/strict'
import { featureCenter, inBounds, boundsAround } from '../src/core/geo/bounds.js'
test('area filter keeps only features inside the box', () => {
  const b = boundsAround(91.8, 24.8, 0.1)
  assert.ok(inBounds(featureCenter({ geometry: { type: 'Point', coordinates: [91.85, 24.85] } }), b))
  assert.ok(!inBounds(featureCenter({ geometry: { type: 'Point', coordinates: [92.5, 24.85] } }), b))
  assert.ok(inBounds([0, 0], null))
  assert.deepEqual(featureCenter({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } }).map((v) => Math.round(v * 10) / 10), [0.8, 0.8])
})
