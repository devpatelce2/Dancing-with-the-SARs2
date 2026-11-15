// These tests use a SYNTHETIC fixture shaped like ASF's documented GeoJSON output.
// They verify OUR parsing/query logic. They do NOT prove ASF's live responses match — run `npm run verify:asf` for that.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQuery, bboxToWkt, normalizeCollection, unwrapRing, fetchAcquisitions, resolveBase, resetResolvedBase, candidateBases } from '../src/data/asf.js'

const feat = (over = {}, geometry) => ({
  type: 'Feature',
  geometry: geometry ?? { type: 'Polygon', coordinates: [[[72, 21], [74, 21], [74, 23], [72, 23], [72, 21]]] },
  properties: {
    sceneName: 'FIXTURE_SCENE_A', startTime: '2026-10-28T01:02:03.000Z', stopTime: '2026-10-28T01:02:30.000Z',
    platform: 'Sentinel-1A', processingLevel: 'SLC', beamModeType: 'IW', flightDirection: 'ASCENDING',
    pathNumber: 12, frameNumber: 345, polarization: 'VV+VH', url: 'https://example.invalid/x.zip', ...over,
  },
})
const ctx = { dataset: 'SENTINEL-1', queryUrl: 'q', retrievedAt: 't' }

test('buildQuery uses documented keywords', () => {
  const p = buildQuery({ dataset: 'NISAR', start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z', bbox: { west: 70, south: 20, east: 75, north: 25 }, maxResults: 50 })
  assert.equal(p.get('dataset'), 'NISAR')
  assert.equal(p.get('processingLevel'), 'GCOV')
  assert.equal(p.get('output'), 'geojson')
  assert.equal(p.get('maxResults'), '50')
  assert.match(p.get('intersectsWith'), /^POLYGON\(\(70\.0000 20\.0000,75\.0000 20\.0000,75\.0000 25\.0000,70\.0000 25\.0000,70\.0000 20\.0000\)\)$/)
})
test('count query has no maxResults; maxResults capped at 1000; unknown dataset rejected', () => {
  assert.equal(buildQuery({ dataset: 'SENTINEL-1', maxResults: 5000 }).get('maxResults'), '1000')
  assert.equal(buildQuery({ dataset: 'SENTINEL-1', maxResults: 5, output: 'count' }).has('maxResults'), false)
  assert.throws(() => buildQuery({ dataset: 'LANDSAT' }))
})
test('antimeridian-crossing / invalid bbox → no area filter', () => {
  assert.equal(bboxToWkt({ west: 170, south: 0, east: -170, north: 10 }), null)
  assert.equal(bboxToWkt({ west: NaN, south: 0, east: 1, north: 2 }), null)
})
test('normalizes a valid feature', () => {
  const { records, rejected } = normalizeCollection({ type: 'FeatureCollection', features: [feat()] }, ctx)
  assert.equal(records.length, 1)
  assert.equal(records[0].id, 'SENTINEL-1:FIXTURE_SCENE_A')
  assert.equal(records[0].path, 12)
  assert.deepEqual(rejected, {})
  assert.ok(Math.abs(records[0].center.lon - 73) < 1e-9)
})
test('rejects bad footprint / time / name, dedupes by id', () => {
  const fc = { type: 'FeatureCollection', features: [
    feat(), feat(), // duplicate
    feat({ sceneName: 'B' }, { type: 'Point', coordinates: [0, 0] }),
    feat({ sceneName: 'C', startTime: 'garbage' }),
    feat({ sceneName: undefined, fileID: undefined }),
    feat({ sceneName: 'E' }, { type: 'Polygon', coordinates: [[[200, 0], [201, 0], [201, 1], [200, 0]]] }),
  ] }
  const r = normalizeCollection(fc, ctx)
  assert.equal(r.records.length, 1)
  assert.equal(r.duplicates, 1)
  assert.equal(r.rejected['missing-or-invalid-footprint'], 2)
  assert.equal(r.rejected['missing-or-invalid-time'], 1)
  assert.equal(r.rejected['missing-scene-name'], 1)
})
test('antimeridian footprint is unwrapped into one continuous shape', () => {
  const ring = [[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]
  const out = unwrapRing(ring)
  assert.deepEqual(out.map((c) => c[0]), [179, 181, 181, 179, 179])
})
test('non-FeatureCollection (e.g. ASF error JSON) throws a readable error', () => {
  assert.throws(() => normalizeCollection({ error: { report: 'Bad query' } }, ctx), /Bad query/)
})
test('fetchAcquisitions: count + results, truncation flag, HTTP error', async () => {
  const fc = { type: 'FeatureCollection', features: [feat()] }
  const ok = async (url) => url.includes('output=count')
    ? { ok: true, text: async () => '42\n' }
    : { ok: true, json: async () => fc }
  const res = await fetchAcquisitions({ dataset: 'SENTINEL-1', maxResults: 1 }, { base: '/api/asf', fetchImpl: ok })
  assert.equal(res.total, 42); assert.equal(res.returned, 1); assert.equal(res.truncated, true)
  const bad = async () => ({ ok: false, status: 400, text: async () => '{"error":"x"}' })
  await assert.rejects(fetchAcquisitions({ dataset: 'NISAR' }, { base: '/api/asf', fetchImpl: bad }), /HTTP 400/)
  const countFails = async (url) => { if (url.includes('output=count')) throw new Error('timeout'); return { ok: true, json: async () => fc } }
  const r2 = await fetchAcquisitions({ dataset: 'SENTINEL-1', maxResults: 500 }, { base: '/api/asf', fetchImpl: countFails })
  assert.equal(r2.total, null); assert.equal(r2.truncated, false)
})

import { cleanErrorText } from '../src/data/asf.js'
test('error bodies: HTML pages reduced to their title, long text truncated', () => {
  assert.equal(cleanErrorText('<!DOCTYPE HTML><html><head><title>Error response</title></head><body><h1>Error response</h1><p>Error code: 404</p></body></html>'), 'Error response')
  assert.equal(cleanErrorText('Internal Server Error'), 'Internal Server Error')
  assert.equal(cleanErrorText('<html><body>no title</body></html>'), '')
  assert.ok(cleanErrorText('x'.repeat(500)).length <= 120)
})

// ---- connectivity: the GitHub Pages failure (no proxy on a static host) and its fixes
const html404 = { ok: false, status: 404, headers: { get: () => 'text/html' }, text: async () => '<title>404</title>' }
const healthy = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }

test('connectivity: candidate order is configured proxy, same-origin proxy, then ASF directly', () => {
  assert.deepEqual(candidateBases('https://proxy.example.dev/'), ['https://proxy.example.dev', '/api/asf', 'https://api.daac.asf.alaska.edu'])
  assert.deepEqual(candidateBases(undefined), ['/api/asf', 'https://api.daac.asf.alaska.edu'])
})
test('connectivity: static host with no proxy falls through to direct ASF when it allows CORS', async () => {
  resetResolvedBase()
  const f = async (url) => url.startsWith('/api/asf') ? html404 : healthy
  const r = await resolveBase({ fetchImpl: f })
  assert.equal(r.base, 'https://api.daac.asf.alaska.edu'); assert.equal(r.attempts[0].status, 404)
})
test('connectivity: a deployed proxy in VITE_ASF_BASE is preferred when healthy', async () => {
  resetResolvedBase()
  const seen = []
  const f = async (url) => { seen.push(url); return healthy }
  const r = await resolveBase({ fetchImpl: f, bases: candidateBases('https://proxy.example.dev') })
  assert.equal(r.base, 'https://proxy.example.dev'); assert.deepEqual(seen, ['https://proxy.example.dev/health'])
})
test('connectivity: nothing reachable gives one clear message naming each attempt and the fix', async () => {
  resetResolvedBase()
  const f = async (url) => { if (url.startsWith('/api/asf')) return html404; throw new TypeError('Failed to fetch') }
  await assert.rejects(resolveBase({ fetchImpl: f }), (e) => {
    assert.equal(e.code, 'ASF_UNREACHABLE'); assert.equal(e.attempts.length, 2)
    assert.match(e.message, /\/api\/asf \(HTTP 404\)/); assert.match(e.message, /CORS or network/); assert.match(e.message, /VITE_ASF_BASE/); assert.match(e.message, /GitHub Pages/)
    return true })
})
test('connectivity: HTML 200 from a static host rewrite is not mistaken for the ASF API', async () => {
  resetResolvedBase()
  const spa = { ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' } }
  const f = async (url) => url.startsWith('/api/asf') ? spa : healthy
  assert.equal((await resolveBase({ fetchImpl: f })).base, 'https://api.daac.asf.alaska.edu')
})
test('connectivity: fetchAcquisitions retries the other bases when the chosen one fails the search', async () => {
  resetResolvedBase()
  const fc = { type: 'FeatureCollection', features: [feat()] }
  const f = async (url) => {
    if (url.endsWith('/health')) return healthy
    if (url.startsWith('/api/asf')) return { ok: false, status: 404, text: async () => '<title>Not found</title>' }
    return url.includes('output=count') ? { ok: true, text: async () => '1' } : { ok: true, json: async () => fc }
  }
  const res = await fetchAcquisitions({ dataset: 'NISAR', maxResults: 1 }, { fetchImpl: f })
  assert.equal(res.returned, 1); assert.equal(res.total, 1)
})
