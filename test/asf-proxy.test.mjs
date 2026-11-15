import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/asf.js'

const mkRes = () => ({ code: 200, headers: {}, body: null, status(c) { this.code = c; return this }, setHeader(k, v) { this.headers[k] = v }, json(o) { this.body = o; return this }, send(b) { this.body = b; return this } })
const withFetch = async (fn) => { const real = globalThis.fetch; const calls = []
  globalThis.fetch = async (u) => { calls.push(String(u)); return new Response('{"features":[]}', { status: 200, headers: { 'content-type': 'application/geo+json' } }) }
  try { await fn(calls) } finally { globalThis.fetch = real } }

test('rewritten search request is forwarded with its own query only', () => withFetch(async (calls) => {
  const res = mkRes(); await handler({ method: 'GET', url: '/api/asf?__path=services/search/param&dataset=NISAR&maxResults=5' }, res)
  assert.equal(res.code, 200); assert.deepEqual(calls, ['https://api.daac.asf.alaska.edu/services/search/param?dataset=NISAR&maxResults=5'])
}))
test('direct path form still works (local tools)', () => withFetch(async (calls) => {
  const res = mkRes(); await handler({ method: 'GET', url: '/api/asf/services/search/param?output=geojson' }, res)
  assert.deepEqual(calls, ['https://api.daac.asf.alaska.edu/services/search/param?output=geojson'])
}))
test('other upstream paths and methods are refused', () => withFetch(async (calls) => {
  const a = mkRes(); await handler({ method: 'GET', url: '/api/asf?__path=services/admin' }, a); assert.equal(a.code, 404)
  const b = mkRes(); await handler({ method: 'POST', url: '/api/asf' }, b); assert.equal(b.code, 405); assert.equal(calls.length, 0)
}))
