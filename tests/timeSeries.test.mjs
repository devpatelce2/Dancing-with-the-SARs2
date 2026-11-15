import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTimeSeries, loadTimeSeries, seriesExtent, niceTicks, linearScale, isOutlier } from '../src/lib/timeSeries.js'

// Structural fixture ONLY to exercise the validator and chart maths — not an observation.
const fixture = () => ({
  schemaVersion: 1, siteId: 'test-site', eventName: 'unit-test fixture', mission: 'NISAR', polarization: 'HHHH',
  bounds: [90, 24, 91, 25], method: { thresholdDb: -3 }, baseline: { meanDb: -11, stdDb: 0.2, n: 3 },
  limitations: ['fixture'],
  points: [
    { time: '2026-06-20T12:00:00+00:00', productId: 'a', meanDb: -11.0, deltaDb: 0, z: 0, changedAreaKm2: 0, overlay: 'ts/20260620T120000.png' },
    { time: '2026-07-02T12:00:00+00:00', productId: 'b', meanDb: -11.2, deltaDb: -0.2, z: -1, changedAreaKm2: 2.5 },
    { time: '2026-07-14T12:00:00+00:00', productId: 'c', meanDb: -12.4, deltaDb: -1.4, z: -7, changedAreaKm2: 40 },
  ],
})

test('valid time series passes', () => assert.equal(validateTimeSeries(fixture()).ok, true))
test('rejects <3 points, wrong order, bad overlay path, missing limitations', () => {
  const a = fixture(); a.points = a.points.slice(0, 2); assert.equal(validateTimeSeries(a).ok, false)
  const b = fixture(); b.points.reverse(); assert.equal(validateTimeSeries(b).ok, false)
  const c = fixture(); c.points[0].overlay = '../secret.png'; assert.equal(validateTimeSeries(c).ok, false)
  const d = fixture(); d.limitations = []; assert.equal(validateTimeSeries(d).ok, false)
  const e = fixture(); e.mission = 'MADE-UP'; assert.equal(validateTimeSeries(e).ok, false)
})
test('null stats are accepted (e.g. z with < 3 baseline scenes), NaN is not', () => {
  const a = fixture(); a.points[1].z = null; assert.equal(validateTimeSeries(a).ok, true)
  const b = fixture(); b.points[1].meanDb = NaN; assert.equal(validateTimeSeries(b).ok, false)
})
test('outlier only when a z-score exists and |z| >= 3', () => {
  assert.equal(isOutlier({ z: -7 }), true); assert.equal(isOutlier({ z: 2.9 }), false); assert.equal(isOutlier({ z: null }), false)
})
test('extent covers points and the 2-sigma band; area domain starts at 0', () => {
  const e = seriesExtent(fixture())
  assert.ok(e.dbMin < -12.4 && e.dbMax > -11 + 0.4); assert.equal(e.areaMin, 0); assert.ok(e.areaMax > 40)
  const f = fixture(); f.points.forEach((p) => { p.changedAreaKm2 = 0 }); assert.equal(seriesExtent(f).areaMax, 1)
})
test('scale + ticks', () => {
  const s = linearScale(0, 10, 100, 0); assert.equal(s(0), 100); assert.equal(s(10), 0); assert.equal(linearScale(5, 5, 0, 10)(5), 5)
  const t = niceTicks(-12.9, -10.4, 4); assert.ok(t.length >= 3 && t.every((v, i) => i === 0 || v > t[i - 1]))
})
test('loadTimeSeries: no sites -> honest reason; invalid file excluded; non-timeseries entries ignored', async () => {
  const mk = (map) => async (url) => (url in map ? { ok: true, status: 200, json: async () => map[url] } : { ok: false, status: 404, json: async () => ({}) })
  assert.equal((await loadTimeSeries({ fetchImpl: mk({}) })).reason.includes('sites.json not found'), true)
  const r0 = await loadTimeSeries({ fetchImpl: mk({ '/data/sites.json': { sites: [] } }) })
  assert.equal(r0.series.length, 0); assert.equal(r0.reason, 'No time series have been processed yet')
  const bad = fixture(); bad.limitations = []
  const r = await loadTimeSeries({ fetchImpl: mk({
    '/data/sites.json': { sites: [{ id: 'test-site', kind: 'timeseries' }, { id: 'bad-one', kind: 'timeseries' }, { id: 'pair-site' }] },
    '/data/test-site/timeseries.json': fixture(), '/data/bad-one/timeseries.json': bad }) })
  assert.equal(r.series.length, 1); assert.equal(r.invalid.length, 1); assert.equal(r.invalid[0].id, 'bad-one'); assert.equal(r.reason, null)
})
test('fmt: no negative zero, null -> dash', async () => {
  const { fmt } = await import('../src/lib/timeSeries.js')
  assert.equal(fmt(-0.0004, 1), '0.0'); assert.equal(fmt(-0.36, 2, ' dB'), '-0.36 dB'); assert.equal(fmt(null), '—')
})
test('compare helpers: default pair, rows, signed format, clamp', async () => {
  const { defaultCompare, compareRows, fmtSigned, clamp01, daysBetween } = await import('../src/lib/timeSeries.js')
  const f = fixture(); f.points[0].isBaseline = true; f.points[1].isBaseline = true
  assert.deepEqual(defaultCompare(f), { a: 1, b: 2 })
  const g = fixture(); assert.deepEqual(defaultCompare(g), { a: 0, b: 2 })                 // no baseline flags -> first vs largest change
  const h = fixture(); h.points.forEach((p) => { p.isBaseline = true }); assert.deepEqual(defaultCompare(h), { a: 0, b: 2 })
  const rows = compareRows(f.points[1], f.points[2])
  assert.ok(Math.abs(rows.find((r) => r.key === 'meanDb').delta - -1.2) < 1e-9); assert.equal(rows.find((r) => r.key === 'changedAreaKm2').delta, 37.5)
  assert.equal(compareRows({ meanDb: null, changedAreaKm2: 1 }, f.points[2])[0].delta, null)
  assert.equal(fmtSigned(1.234, 2, ' dB'), '+1.23 dB'); assert.equal(fmtSigned(-1.2, 1), '-1.2'); assert.equal(fmtSigned(0.0001, 1), '0.0'); assert.equal(fmtSigned(null), '—')
  assert.equal(clamp01(-1), 0.02); assert.equal(clamp01(2), 0.98); assert.equal(daysBetween(f.points[0], f.points[1]), 12)
})
test('image path validated; synthetic must be boolean', () => {
  const a = fixture(); a.points[0].image = 'ts/20260620T120000_db.png'; a.synthetic = true; assert.equal(validateTimeSeries(a).ok, true)
  const b = fixture(); b.points[0].image = 'http://evil/x.png'; assert.equal(validateTimeSeries(b).ok, false)
  const c = fixture(); c.synthetic = 'yes'; assert.equal(validateTimeSeries(c).ok, false)
})

test('a Sentinel-1 time series is accepted and an unknown mission is not', () => {
  const s = fixture(); s.mission = 'SENTINEL-1'; s.polarization = 'VV'
  assert.equal(validateTimeSeries(s).ok, true)
  const bad = fixture(); bad.mission = 'LANDSAT'
  assert.equal(validateTimeSeries(bad).ok, false)
})
test('validation summary: null when absent, percentages and n/a when present', async () => {
  const { validationSummary } = await import('../src/lib/timeSeries.js')
  assert.equal(validationSummary(null), null); assert.equal(validationSummary({ method: 'x', reference: 'y' }), null)
  const v = validationSummary({ method: 'm', reference: 'OPERA DSWx - NASA', sarDate: '2026-07-14', referenceDate: '2026-07-15', daysApart: 1,
    metrics: { precision: 0.5, recall: 0.826, f1: 0.62, iou: null, pixelsCompared: 9450 }, caveats: ['a'] })
  assert.deepEqual(v.rows.map((r) => r.v), ['50%', '83%', '0.62', 'n/a']); assert.equal(v.pixels, 9450); assert.equal(v.daysApart, 1); assert.equal(v.caveats.length, 1)
})
test('story findings are computed from the file: darkest, brightest, peak, honest caveats', async () => {
  const { storyFindings, boundsAreaKm2 } = await import('../src/lib/timeSeries.js')
  const { storyFor } = await import('../src/content/stories.js')
  const f = fixture(); f.points[2].isBaseline = true; f.points[2].changedPercent = 3.2
  const s = storyFindings(f)
  assert.equal(s.darkestIndex, 2); assert.equal(s.brightestIndex, 0); assert.equal(s.peakIndex, 2)
  const text = s.sentences.join(' ')
  assert.match(text, /darkest on 2026-07-14 \(-12\.40 dB\)/); assert.match(text, /40\.0 km² was at least 3 dB darker/); assert.match(text, /about 3\.2% of the area/)
  assert.match(text, /understates the change/); assert.match(text, /not been checked against an independent reference map/)
  const g = fixture(); g.points.push({ time: '2026-07-26T12:00:00+00:00', productId: 'd', meanDb: -11.0, deltaDb: 0, z: 0, changedAreaKm2: 0 }, { time: '2026-08-07T12:00:00+00:00', productId: 'e', meanDb: -12.3, deltaDb: -1.3, z: -6, changedAreaKm2: 1 })
  g.points[0].meanDb = -11.5; assert.match(storyFindings(g).sentences.join(' '), /last pass, on 2026-08-07, was darker again/)
  const v = fixture(); v.validation = { method: 'm', reference: 'OPERA DSWx - NASA', metrics: { precision: 0.5 } }; assert.match(storyFindings(v).sentences.join(' '), /compared with OPERA DSWx - NASA/)
  assert.ok(Math.abs(boundsAreaKm2([91.5828, 24.6347, 91.7874, 24.8379]) - 465) < 3); assert.equal(boundsAreaKm2(null), null)
  const st = storyFor('sylhet'); assert.ok(st && storyFor('bangladesh') === null && storyFor('noto-peninsula').kind === 'earthquake')
  for (const c of st.chapters) for (const t of c.text) for (const m of t.matchAll(/\[(\d+)\]/g)) assert.ok(st.sources[+m[1] - 1], `source ${m[1]} exists`)
})
test('case studies: one per kind, every reference resolves, story-only ones carry a process command and a box', async () => {
  const { CASE_STUDIES, storyFor } = await import('../src/content/stories.js')
  const { validateBounds } = await import('../src/lib/siteData.js')
  assert.deepEqual(CASE_STUDIES.map((c) => c.key), ['flood', 'earthquake', 'wildfire', 'landslide'])
  for (const c of CASE_STUDIES) {
    const st = c.story; assert.equal(st.kind, c.key); assert.ok(st.label && st.place && st.title && st.chapters.length >= 4)
    assert.equal(st.chapters.filter((ch) => ch.figure === 'findings').length, 1, `${c.key} has exactly one findings chapter`)
    for (const ch of st.chapters) for (const t of ch.text) for (const m of t.matchAll(/\[(\d+)\]/g)) assert.ok(st.sources[+m[1] - 1], `${c.key}: source ${m[1]}`)
    for (const [label, url] of st.sources) { assert.ok(label); assert.match(url, /^https:\/\//) }
    for (const id of c.siteIds) assert.equal(storyFor(id), st)
  }
  for (const key of ['wildfire', 'landslide']) {
    const st = CASE_STUDIES.find((c) => c.key === key).story
    assert.ok(validateBounds(st.bounds)); assert.match(st.process, /^python -m pipeline\.quick /); assert.match(st.process, /--threshold-db -\d/)
    const b = st.process.match(/--bbox (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/).slice(1).map(Number); assert.deepEqual(b, st.bounds)   // command and map box agree
  }
})
test('findings say so when the largest change is before the event date', async () => {
  const { storyFindings } = await import('../src/lib/timeSeries.js')
  const f = fixture(); f.eventDate = '2026-08-01'
  assert.match(storyFindings(f).sentences.join(' '), /before the event \(2026-08-01\), so the event did not cause it/)
  const g = fixture(); g.eventDate = '2026-07-01'; assert.doesNotMatch(storyFindings(g).sentences.join(' '), /before the event/)
})
