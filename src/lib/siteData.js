// Data contract for processed flood sites (written by pipeline/, read by the frontend).
//   public/data/sites.json                 -> { schemaVersion, sites: [{ id, name, metaUrl }] }
//   public/data/<site_id>/meta.json        -> validated by validateMeta()
//   public/data/<site_id>/{before,after,change}.png, change.geojson
// Every statistic shown in the UI must come from meta.json. Nothing here invents values.

export const SCHEMA_VERSION = 1
const SITE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MISSIONS = ['NISAR', 'SENTINEL-1'] // any non-NISAR mission must be labelled as such in the UI

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

export function validateBounds(b) {
  return Array.isArray(b) && b.length === 4 && b.every(isNum) &&
    b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90 && b[0] < b[2] && b[1] < b[3]
}

/** Returns { ok, errors[] }. Strict on purpose: incomplete metadata must not render as science. */
export function validateMeta(m) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(m && typeof m === 'object', 'meta is not an object')
  if (errors.length) return { ok: false, errors }
  need(m.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`)
  need(SITE_ID.test(m.siteId ?? ''), 'siteId invalid')
  need(typeof m.eventName === 'string' && m.eventName.length > 0, 'eventName missing')
  need(MISSIONS.includes(m.mission), `mission must be one of ${MISSIONS.join(', ')}`)
  need(validateBounds(m.bounds), 'bounds must be [W,S,E,N] in degrees (EPSG:4326)')
  need(typeof m.crs === 'string' && m.crs.length > 0, 'crs missing')
  for (const k of ['before', 'after']) {
    const s = m[k]
    need(s && typeof s.productId === 'string' && s.productId.length > 0, `${k}.productId missing`)
    need(s && isIso(s.acquisitionTime), `${k}.acquisitionTime invalid`)
    need(s && typeof s.polarization === 'string' && s.polarization.length > 0, `${k}.polarization missing`)
  }
  if (m.before && m.after && isIso(m.before.acquisitionTime) && isIso(m.after.acquisitionTime)) {
    need(Date.parse(m.before.acquisitionTime) < Date.parse(m.after.acquisitionTime), 'before must precede after')
  }
  const st = m.stats
  need(st && isNum(st.affectedAreaKm2) && st.affectedAreaKm2 >= 0, 'stats.affectedAreaKm2 missing')
  need(st && Number.isInteger(st.changedPixels) && st.changedPixels >= 0, 'stats.changedPixels missing')
  need(m.method && typeof m.method.name === 'string' && isNum(m.method.thresholdDb), 'method.name / method.thresholdDb missing')
  need(m.quality && typeof m.quality === 'object', 'quality missing')
  need(Array.isArray(m.limitations) && m.limitations.length > 0, 'limitations must list at least one entry')
  // validation is optional, but if present it must say how it was done — accuracy numbers are never invented.
  if (m.validation != null) {
    need(typeof m.validation.method === 'string' && m.validation.method.length > 0, 'validation.method missing')
    need(typeof m.validation.reference === 'string' && m.validation.reference.length > 0, 'validation.reference missing')
  }
  return { ok: errors.length === 0, errors }
}

/** Load sites.json + every meta.json. Invalid sites are reported, never rendered. */
export async function loadSites({ base = '/data', fetchImpl = fetch, signal } = {}) {
  let idx
  try {
    const r = await fetchImpl(`${base}/sites.json`, { signal })
    if (!r.ok) return { sites: [], invalid: [], reason: `sites.json not found (HTTP ${r.status})` }
    idx = await r.json()
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    return { sites: [], invalid: [], reason: `sites.json unreadable: ${e.message}` }
  }
  const entries = Array.isArray(idx?.sites) ? idx.sites : []
  const sites = []; const invalid = []
  for (const e of entries) {
    try {
      if (!SITE_ID.test(e?.id ?? '')) throw new Error('bad site id')
      const r = await fetchImpl(`${base}/${e.id}/meta.json`, { signal })
      if (!r.ok) throw new Error(`meta.json HTTP ${r.status}`)
      const meta = await r.json()
      const v = validateMeta(meta)
      if (!v.ok) throw new Error(v.errors.join('; '))
      sites.push({ id: e.id, base: `${base}/${e.id}`, meta })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      invalid.push({ id: e?.id ?? null, error: err.message })
    }
  }
  const reason = sites.length ? null : entries.length ? 'All listed sites failed validation' : 'No sites have been processed yet'
  return { sites, invalid, reason }
}
