// Live verification against ASF DAAC. Run: npm run verify:asf
// Network access is required. This script never treats fixtures as live evidence.
import { buildQuery, searchUrl, normalizeCollection, ASF_UPSTREAM } from '../src/data/asf.js'

const now = new Date()
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z')
const failed = []

async function request(url, label) {
  const res = await fetch(url, { headers: { Accept: 'application/geo+json, application/json' } })
  const body = await res.text()
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}: ${body.slice(0, 300)}`)
  return body
}

try {
  const health = await request(`${ASF_UPSTREAM}/health`, 'ASF health')
  console.log(`ASF health: HTTP OK; response=${health.slice(0, 200)}`)
} catch (error) {
  console.error(`ASF health: FAILED — ${error.message}`)
  failed.push('health')
}

for (const dataset of ['NISAR', 'SENTINEL-1']) {
  // NISAR has a newer archive; search a broader window so a short quiet period
  // does not incorrectly look like a broken integration.
  const days = dataset === 'NISAR' ? 180 : 30
  const start = new Date(now.getTime() - days * 864e5)
  const params = buildQuery({ dataset, start: iso(start), end: iso(now), maxResults: 10 })
  const url = searchUrl(params, ASF_UPSTREAM)
  try {
    const text = await request(url, `${dataset} search`)
    const fc = JSON.parse(text)
    if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      throw new Error(`Unexpected response schema: ${JSON.stringify(fc).slice(0, 300)}`)
    }
    const normalized = normalizeCollection(fc, {
      dataset, queryUrl: url, retrievedAt: iso(new Date()),
    })
    console.log(`\n${dataset}: ${fc.features.length} live catalogue feature(s); ${normalized.records.length} normalized; rejected=${JSON.stringify(normalized.rejected)}`)
    if (fc.features[0]) {
      console.log('  Actual property keys:', Object.keys(fc.features[0].properties ?? {}).join(', '))
      console.log('  First actual record:', JSON.stringify({
        id: normalized.records[0]?.id ?? null,
        sceneName: normalized.records[0]?.sceneName ?? null,
        processingLevel: normalized.records[0]?.processingLevel ?? null,
        startTime: normalized.records[0]?.startTime ?? null,
        downloadUrlPresent: Boolean(normalized.records[0]?.downloadUrl),
      }, null, 2))
    }
    if (dataset === 'NISAR') {
      const gcov = normalized.records.filter((r) => r.processingLevel === 'GCOV')
      console.log(`  NISAR GCOV records confirmed: ${gcov.length}`)
      if (normalized.records.length && gcov.length === 0) {
        console.warn('  WARNING: NISAR results returned, but no normalized record explicitly reports GCOV.')
      }
      if (fc.features.length === 0) console.warn('  WARNING: valid live response, but no NISAR results in this date window.')
    }
  } catch (error) {
    console.error(`\n${dataset}: FAILED — ${error.message}`)
    failed.push(dataset)
  }
}

if (failed.length) {
  console.error(`\nLive verification incomplete. Failed checks: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nCatalogue endpoint and response-schema checks completed. A zero-result response is not proof of product availability.')
