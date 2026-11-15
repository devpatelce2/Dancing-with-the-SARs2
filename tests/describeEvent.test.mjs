import test from 'node:test'; import assert from 'node:assert/strict'
import { describe } from '../src/data/describeEvent.js'
test('earthquake shows magnitude and depth, strips the id suffix', () => {
  const d = describe({ properties: { layerId: 'earthquakes', source: 'USGS', timestamp: '2026-11-01T03:00:00Z', productId: 'x', metadata: { depthKm: 10.2, original: { title: 'M 5.1 - Test [us123]', mag: 5.1 } } } })
  assert.equal(d.title, 'M 5.1 - Test'); assert.deepEqual(d.bits, ['M5.1', '10 km deep']); assert.equal(d.when, '2026-11-01')
})
test('EONET flood is marked ongoing and exposes its link', () => {
  const d = describe({ properties: { layerId: 'floods', source: 'NASA EONET', timestamp: '2026-10-20T00:00:00Z', productId: 'p', metadata: { original: { title: 'Flood, Sylhet', link: 'https://eonet.gsfc.nasa.gov/x', closed: null } } } })
  assert.ok(d.bits.includes('ongoing')); assert.equal(d.link, 'https://eonet.gsfc.nasa.gov/x')
})
