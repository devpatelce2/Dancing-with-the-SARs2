import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { imageMeta, IMAGE_META_REQUIRED_ROWS } from '../src/lib/imageMeta.js'

const sites = JSON.parse(fs.readFileSync('public/data/sites.json', 'utf8')).sites
test('every bundled radar image has complete source attribution and metadata', () => {
  assert.ok(sites.length >= 3)
  for (const s of sites) {
    const ts = JSON.parse(fs.readFileSync(`public/data/${s.id}/timeseries.json`, 'utf8'))
    for (const p of ts.points) for (const kind of ['overlay', 'image', 'diff']) {
      const m = imageMeta(ts, p, kind)
      assert.deepEqual(m.rows.map((r) => r[0]), IMAGE_META_REQUIRED_ROWS)
      for (const [label, value] of m.rows) assert.ok(String(value).trim() && !/undefined|NaN|null/.test(value), `${s.id} ${kind} ${label}: ${value}`)
      assert.match(m.rows.find((r) => r[0] === 'Acquired')[1], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)
    }
  }
})
test('credit names the right agency and never claims NASA owns Sentinel-1', () => {
  const nis = imageMeta({ mission: 'NISAR', siteId: 'x' }, { time: '2026-07-14T12:34:23+00:00' }, 'overlay')
  const s1 = imageMeta({ mission: 'SENTINEL-1', siteId: 'x' }, { time: '2024-01-01T00:00:00Z' }, 'overlay')
  assert.match(nis.rows.find((r) => r[0] === 'Credit')[1], /NASA and ISRO/)
  assert.match(s1.rows.find((r) => r[0] === 'Credit')[1], /Copernicus Sentinel data \(ESA\)/)
  assert.doesNotMatch(s1.rows.find((r) => r[0] === 'Satellite')[1], /NASA/)
})
test('synthetic data is labelled as such and never as an observation', () => {
  const m = imageMeta({ mission: 'NISAR', synthetic: true, siteId: 'd' }, { time: '2026-01-01T00:00:00Z' }, 'overlay')
  assert.equal(m.synthetic, true); assert.match(m.rows.find((r) => r[0] === 'Status')[1], /SYNTHETIC/)
})
test('without validation the status says candidates only', () => {
  const m = imageMeta({ mission: 'NISAR', siteId: 'x', validation: null }, { time: '2026-07-14T12:34:23+00:00' }, 'overlay')
  assert.match(m.rows.find((r) => r[0] === 'Status')[1], /not validated against an independent reference/)
})
