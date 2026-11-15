import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSites, rebuildIndex } from '../scripts/rebuild-index.mjs'

test('index lists every folder with data, skips geo / broken / badly named folders, replaces a stale index', () => {
  const root = mkdtempSync(join(tmpdir(), 'sites-'))
  const mk = (id, file, body) => { mkdirSync(join(root, id), { recursive: true }); if (file) writeFileSync(join(root, id, file), body) }
  mk('sylhet', 'timeseries.json', '{"name":"Sylhet"}'); mk('noto-peninsula', 'timeseries.json', '{"name":"Noto Peninsula"}')
  mk('pair-site', 'meta.json', '{"name":"Pair"}'); mk('geo', 'countries.json', '{}'); mk('broken', 'timeseries.json', '{not json'); mk('Bad Name', 'timeseries.json', '{}')
  mk('noname', 'timeseries.json', '{}')
  writeFileSync(join(root, 'sites.json'), '{"schemaVersion":1,"sites":[{"id":"noto-peninsula","name":"Noto Peninsula","kind":"timeseries"}]}')
  assert.deepEqual(scanSites(root).map((s) => s.id), ['noname', 'noto-peninsula', 'pair-site', 'sylhet'])
  rebuildIndex(root)
  const idx = JSON.parse(readFileSync(join(root, 'sites.json'), 'utf8'))
  assert.equal(idx.sites.length, 4); assert.equal(idx.sites.find((s) => s.id === 'sylhet').kind, 'timeseries')
  assert.equal(idx.sites.find((s) => s.id === 'pair-site').kind, undefined); assert.equal(idx.sites.find((s) => s.id === 'noname').name, 'noname')
})
