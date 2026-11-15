// ASF DAAC Search API client — Sentinel-1 and NISAR acquisition metadata + footprints.
// Docs: https://docs.asf.alaska.edu/api/keywords/
//
// Everything returned from this module is REAL catalog metadata (provenance is attached
// to every record). Nothing here fabricates or interpolates footprints.

const ENV_BASE = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ASF_BASE : undefined

// Where requests go. The browser cannot always call ASF directly, so the client tries these in order and
// keeps the first one that answers a health check:
//   1. VITE_ASF_BASE  - a proxy you deployed (Cloudflare Worker / Vercel). Needed on static hosts such as GitHub Pages.
//   2. /api/asf       - same-origin proxy: Vite's dev server, or the Vercel function in api/asf.js.
//   3. ASF itself     - works only if ASF answers the browser's CORS check from your site.
export const ASF_BASE = ENV_BASE || '/api/asf'
export const ASF_UPSTREAM = 'https://api.daac.asf.alaska.edu'
const SEARCH_PATH = '/services/search/param'

// `dataset` values and `processingLevel` values are taken from the ASF keyword docs.
// Default levels are chosen so each acquisition appears ONCE (SLC / RSLC), instead of
// once per derived product (GRD, OCN, RAW, METADATA_* …) which would stack duplicate footprints.
export const DATASETS = {
  'SENTINEL-1': {
    label: 'Sentinel-1',
    color: '#5fb4ff',
    defaultLevel: 'GRD_HD',
    levels: ['GRD_HD', 'GRD_MD', 'GRD_FD', 'SLC', 'RAW', 'OCN'],
  },
  NISAR: {
    label: 'NISAR',
    color: '#ffb454',
    defaultLevel: 'GCOV',
    levels: ['GCOV', 'GSLC', 'RSLC', 'RIFG', 'RUNW', 'GUNW', 'GOFF', 'ROFF', 'SME2', 'L0B'],
  },
}

export const MAX_RESULTS_CAP = 1000

/** Build a closed WKT polygon from a lon/lat box. Returns null for global/invalid/antimeridian-crossing boxes. */
export function bboxToWkt({ west, south, east, north }) {
  const v = [west, south, east, north]
  if (!v.every(Number.isFinite)) return null
  if (west >= east || south >= north) return null // crossing the antimeridian: caller falls back to no area filter
  const w = Math.max(-180, west), e = Math.min(180, east)
  const s = Math.max(-90, south), n = Math.min(90, north)
  const r = (x) => x.toFixed(4)
  return `POLYGON((${r(w)} ${r(s)},${r(e)} ${r(s)},${r(e)} ${r(n)},${r(w)} ${r(n)},${r(w)} ${r(s)}))`
}

export function buildQuery({ dataset, start, end, bbox, processingLevel, maxResults, output = 'geojson' }) {
  if (!DATASETS[dataset]) throw new Error(`Unknown dataset: ${dataset}`)
  const p = new URLSearchParams()
  p.set('dataset', dataset)
  p.set('processingLevel', processingLevel || DATASETS[dataset].defaultLevel)
  if (start) p.set('start', start)
  if (end) p.set('end', end)
  const wkt = bbox ? bboxToWkt(bbox) : null
  if (wkt) p.set('intersectsWith', wkt)
  if (output !== 'count' && maxResults) {
    p.set('maxResults', String(Math.min(Number(maxResults) || 0, MAX_RESULTS_CAP)))
  }
  p.set('output', output)
  return p
}

export function searchUrl(params, base = ASF_BASE) {
  return `${base}${SEARCH_PATH}?${params.toString()}`
}

async function readError(res) {
  let detail = ''
  try { detail = cleanErrorText(await res.text()) } catch { /* ignore */ }
  return new Error(`ASF API HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
}

/** Lightweight availability check. Returns { ok, status, body } — body is whatever ASF returned. */
export async function checkSource({ base, signal, fetchImpl = fetch } = {}) {
  const chosen = base ?? (await resolveBase({ fetchImpl, signal })).base
  const res = await fetchImpl(`${chosen}/health`, { signal })
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, body, base: chosen }
}

// ---------------------------------------------------------------- connectivity

export function candidateBases(env = ENV_BASE) {
  const list = []
  if (env) list.push(String(env).replace(/\/+$/, ''))
  list.push('/api/asf', ASF_UPSTREAM)
  return [...new Set(list)]
}

/** One plain-language message that says what was tried and what to do, instead of a bare "HTTP 404". */
export function explainUnreachable(attempts) {
  const tried = attempts.map((a) => `${a.base} (${a.reason})`).join('; ')
  const staticHost = attempts.some((a) => a.status === 404 || a.status === 405)
  return `Could not reach the ASF catalogue. Tried: ${tried}. `
    + (staticHost
      ? 'This site has no server-side proxy (GitHub Pages and other static hosts cannot run one). Deploy the proxy in deploy/ (Cloudflare Worker or Vercel) and rebuild with VITE_ASF_BASE set to its URL. See README, "Deploying the catalogue proxy".'
      : 'Check your internet connection, or deploy the proxy in deploy/ and set VITE_ASF_BASE. See README.')
}

let resolvedBase = null
let resolving = null // in-flight check shared by simultaneous searches (Sentinel-1 and NISAR start together)
export function resetResolvedBase() { resolvedBase = null; resolving = null }
export function getResolvedBase() { return resolvedBase }

/** Find a working base. Cached after the first success; throws an Error with `.attempts` when none works. */
export async function resolveBase(opts = {}) {
  const { bases = candidateBases(), signal } = opts
  const aborted = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError') }
  if (resolvedBase && bases.includes(resolvedBase)) return { base: resolvedBase, attempts: [] }
  if (opts.bases) return probeBases(opts) // caller supplied its own list: do not share
  // The shared check ignores any one caller's signal, so one search being cancelled cannot fail the other.
  if (!resolving) resolving = probeBases({ ...opts, signal: undefined }).finally(() => { resolving = null })
  const result = await resolving
  aborted()
  return result
}

async function probeBases({ fetchImpl = fetch, signal, bases = candidateBases(), timeoutMs = 8000 } = {}) {
  const attempts = []
  for (const base of bases) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined })
      const type = res.headers?.get?.('content-type') ?? ''
      if (res.ok && !/text\/html/i.test(type)) { resolvedBase = base; return { base, attempts } }
      attempts.push({ base, status: res.status, reason: res.ok ? 'answered with a web page, not the ASF API' : `HTTP ${res.status}` })
    } catch (e) {
      if (signal?.aborted) throw e
      attempts.push({ base, status: 0, reason: e?.name === 'TimeoutError' ? 'timed out' : 'blocked or unreachable (CORS or network)' })
    }
  }
  const err = new Error(explainUnreachable(attempts))
  err.code = 'ASF_UNREACHABLE'; err.attempts = attempts
  throw err
}

const isConnectivityError = (e) => e?.code === 'ASF_UNREACHABLE' || e instanceof TypeError || /HTTP (404|405|502|503|504)\b/.test(e?.message ?? '')

// ---------------------------------------------------------------- normalisation

function ringFromGeometry(geometry) {
  if (!geometry) return null
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] ?? null
  // Take the largest outer ring of a MultiPolygon so we never silently drop the footprint.
  if (geometry.type === 'MultiPolygon') {
    const rings = (geometry.coordinates ?? []).map((poly) => poly?.[0]).filter(Boolean)
    return rings.sort((a, b) => b.length - a.length)[0] ?? null
  }
  return null
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
      c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90,
  )
}

/** If a footprint straddles the antimeridian, shift western longitudes by +360 so it draws as one shape. */
export function unwrapRing(ring) {
  const lons = ring.map((c) => c[0])
  if (Math.max(...lons) - Math.min(...lons) <= 180) return ring
  return ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat])
}

function centroid(ring) {
  const pts = ring.slice(0, -1)
  const lon = pts.reduce((a, c) => a + c[0], 0) / pts.length
  const lat = pts.reduce((a, c) => a + c[1], 0) / pts.length
  return { lon: lon > 180 ? lon - 360 : lon, lat }
}

const pick = (obj, keys) => keys.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null && v !== '')

/**
 * Convert one GeoJSON feature from ASF into our record shape, or return { reject: reason }.
 * Property names (sceneName, startTime, stopTime, platform, processingLevel, beamModeType,
 * flightDirection, pathNumber, frameNumber, polarization, url, centerLat/centerLon …) are the ones
 * ASF's GeoJSON output uses for Sentinel-1. NISAR products may expose extra/different fields, so every
 * optional field is read defensively and NISAR-specific extras are only shown if they are present.
 */
export function normalizeFeature(feature, { dataset, queryUrl, retrievedAt }) {
  const p = feature?.properties ?? {}
  const ring0 = ringFromGeometry(feature?.geometry)
  if (!validRing(ring0)) return { reject: 'missing-or-invalid-footprint' }

  const startTime = pick(p, ['startTime'])
  if (!startTime || Number.isNaN(Date.parse(startTime))) return { reject: 'missing-or-invalid-time' }

  const sceneName = pick(p, ['sceneName', 'fileID', 'granuleName'])
  if (!sceneName) return { reject: 'missing-scene-name' }

  const ring = unwrapRing(ring0)
  const c = Number.isFinite(Number(p.centerLon)) && Number.isFinite(Number(p.centerLat))
    ? { lon: Number(p.centerLon), lat: Number(p.centerLat) }
    : centroid(ring)

  const extra = {}
  for (const k of ['frameCoverage', 'jointObservation', 'productionConfiguration', 'dataMaturity', 'rangeBandwidth', 'mainBandPolarization', 'sideBandPolarization']) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') extra[k] = p[k]
  }

  return {
    record: {
      id: `${dataset}:${sceneName}`,
      dataset,
      platform: pick(p, ['platform', 'sensor']) ?? DATASETS[dataset].label,
      sceneName,
      startTime,
      stopTime: pick(p, ['stopTime']) ?? null,
      processingLevel: pick(p, ['processingLevel']) ?? null,
      beamMode: pick(p, ['beamModeType', 'beamMode']) ?? null,
      polarization: pick(p, ['polarization', 'mainBandPolarization']) ?? null,
      flightDirection: pick(p, ['flightDirection']) ?? null,
      absoluteOrbit: pick(p, ['orbit']) ?? null,
      path: pick(p, ['pathNumber', 'relativeOrbit']) ?? null,
      frame: pick(p, ['frameNumber']) ?? null,
      downloadUrl: pick(p, ['url']) ?? null, // requires NASA Earthdata login to download; metadata does not
      center: c,
      ring, // [[lon, lat], …] closed, longitudes may exceed 180 after antimeridian unwrap
      extra,
      provenance: { provider: 'ASF DAAC Search API', endpoint: `${ASF_UPSTREAM}${SEARCH_PATH}`, queryUrl, retrievedAt },
    },
  }
}

/** Normalise a FeatureCollection → { records, rejected: {reason: n}, duplicates } (deduped by id). */
export function normalizeCollection(fc, ctx) {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    const msg = fc?.error?.report || fc?.error || 'unexpected response shape (not a GeoJSON FeatureCollection)'
    throw new Error(`ASF API: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  const seen = new Map()
  const rejected = {}
  let duplicates = 0
  for (const f of fc.features) {
    const out = normalizeFeature(f, ctx)
    if (out.reject) { rejected[out.reject] = (rejected[out.reject] ?? 0) + 1; continue }
    if (seen.has(out.record.id)) { duplicates += 1; continue }
    seen.set(out.record.id, out.record)
  }
  return { records: [...seen.values()], rejected, duplicates }
}

// ---------------------------------------------------------------- fetching

/**
 * Fetch acquisitions for ONE dataset. Runs a count query (best effort) plus the capped GeoJSON query so the
 * UI can say "showing 500 of 18,342" instead of silently presenting a truncated sample as complete.
 */
export async function fetchAcquisitions(opts, { base, signal, fetchImpl = fetch } = {}) {
  if (base) return fetchFrom(opts, { base, signal, fetchImpl }) // caller pinned a base: no fallback
  const first = await resolveBase({ fetchImpl, signal })
  try { return await fetchFrom(opts, { base: first.base, signal, fetchImpl }) } catch (e) {
    if (!isConnectivityError(e) || signal?.aborted) throw e
    resetResolvedBase() // it answered the health check but failed the search: try the others
    const others = candidateBases().filter((b) => b !== first.base)
    if (!others.length) throw e
    const next = await resolveBase({ fetchImpl, signal, bases: others })
    return fetchFrom(opts, { base: next.base, signal, fetchImpl })
  }
}

async function fetchFrom(opts, { base, signal, fetchImpl }) {
  const geoParams = buildQuery({ ...opts, output: 'geojson' })
  const countParams = buildQuery({ ...opts, output: 'count' })
  const queryUrl = `${ASF_UPSTREAM}${SEARCH_PATH}?${geoParams.toString()}`

  const countPromise = fetchImpl(searchUrl(countParams, base), { signal })
    .then(async (r) => (r.ok ? Number.parseInt((await r.text()).trim(), 10) : null))
    .then((n) => (Number.isFinite(n) ? n : null))
    .catch((e) => { if (e?.name === 'AbortError') throw e; return null }) // count is best-effort

  const res = await fetchImpl(searchUrl(geoParams, base), { signal })
  if (!res.ok) throw await readError(res)
  const fc = await res.json()

  const retrievedAt = new Date().toISOString()
  const { records, rejected, duplicates } = normalizeCollection(fc, { dataset: opts.dataset, queryUrl, retrievedAt })
  const total = await countPromise
  return {
    dataset: opts.dataset,
    records,
    rejected,
    duplicates,
    returned: fc.features.length,
    total, // null when the count query failed or timed out
    truncated: total !== null ? total > fc.features.length : fc.features.length >= Math.min(opts.maxResults ?? Infinity, MAX_RESULTS_CAP),
    queryUrl,
    retrievedAt,
  }
}

/** Server error bodies are often whole HTML pages; show a short plain-text reason instead of markup. */
export function cleanErrorText(body, max = 120) {
  const raw = String(body ?? '')
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(raw)?.[1]
  const text = (/<\s*(!doctype|html|head|body)/i.test(raw) ? (title ?? '') : raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
