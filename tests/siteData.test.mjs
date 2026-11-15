import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMeta, validateBounds, loadSites } from '../src/lib/siteData.js'

// Structural fixture ONLY to exercise the validator — not a flood event, not an observation.
const fixture = () => ({
  schemaVersion: 1, siteId: 'test-site', eventName: 'unit-test fixture', mission: 'NISAR',
  bounds: [70, 20, 71, 21], crs: 'EPSG:4326',
  before: { productId: 'A', acquisitionTime: '2025-01-01T00:00:00Z', polarization: 'HH' },
  after: { productId: 'B', acquisitionTime: '2025-02-01T00:00:00Z', polarization: 'HH' },
  stats: { affectedAreaKm2: 0, changedPixels: 0 },
  method: { name: 'log-ratio', thresholdDb: -3 }, quality: {}, limitations: ['fixture'],
})

test('valid meta passes', () => assert.equal(validateMeta(fixture()).ok, true))
test('missing stats / bad mission / reversed dates are rejected', () => {
  const a = fixture(); delete a.stats; assert.equal(validateMeta(a).ok, false)
  const b = fixture(); b.mission = 'MADE-UP'; assert.equal(validateMeta(b).ok, false)
  const c = fixture(); c.before.acquisitionTime = '2026-01-01T00:00:00Z'; assert.equal(validateMeta(c).ok, false)
})
test('validation block must state method and reference', () => {
  const m = fixture(); m.validation = { f1: 0.9 }; assert.equal(validateMeta(m).ok, false)
})
test('bounds checks', () => {
  assert.equal(validateBounds([70, 20, 71, 21]), true)
  assert.equal(validateBounds([71, 20, 70, 21]), false)
  assert.equal(validateBounds([0, 0, 200, 10]), false)
})
test('loadSites: empty index -> honest reason; invalid meta is excluded', async () => {
  const mk = (map) => async (url) => (url in map ? { ok: true, status: 200, json: async () => map[url] } : { ok: false, status: 404, json: async () => ({}) })
  const e = await loadSites({ fetchImpl: mk({ '/data/sites.json': { sites: [] } }) })
  assert.equal(e.sites.length, 0); assert.match(e.reason, /No sites/)
  const bad = await loadSites({ fetchImpl: mk({ '/data/sites.json': { sites: [{ id: 'x1' }] }, '/data/x1/meta.json': { siteId: 'x1' } }) })
  assert.equal(bad.sites.length, 0); assert.equal(bad.invalid.length, 1)
  const ok = await loadSites({ fetchImpl: mk({ '/data/sites.json': { sites: [{ id: 'test-site' }] }, '/data/test-site/meta.json': fixture() }) })
  assert.equal(ok.sites.length, 1)
})
