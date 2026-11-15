// Real hazard events for the disaster layers. Nothing is generated: every record comes from the source API below.
//   Earthquakes: USGS Earthquake Hazards Program (FDSN event service, GeoJSON)
//   Floods, wildfires, volcanoes, landslides, droughts, severe storms: NASA EONET v3 (curated from GDACS, InciWeb, etc.)
import { toIsoUtc } from '../core/data/schema.js'

const DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV
const USGS = DEV ? '/api/usgs' : 'https://earthquake.usgs.gov/fdsnws/event/1'
const EONET = DEV ? '/api/eonet' : 'https://eonet.gsfc.nasa.gov/api/v3'

// registry layer id -> source
export const HAZARD_SOURCES = {
  earthquakes: { source: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/map/' },
  floods: { source: 'NASA EONET', eonet: 'floods' },
  wildfires: { source: 'NASA EONET', eonet: 'wildfires' },
  volcanoes: { source: 'NASA EONET', eonet: 'volcanoes' },
  landslides: { source: 'NASA EONET', eonet: 'landslides' },
  droughts: { source: 'NASA EONET', eonet: 'drought' },
  cyclones: { source: 'NASA EONET', eonet: 'severeStorms' },
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10)

function obs(layerId, source, pid, geometry, ts, end, props) {
  return { type: 'Feature', id: `${source}:${pid}`, geometry, properties: {
    layerId, kind: 'disaster', category: layerId, mission: null, platform: null, productId: pid, productType: null,
    timestamp: ts, endTimestamp: end ?? null, orbitDirection: null, polarization: null, source,
    verificationStatus: 'verified', metadata: props } }
}

export function normalizeUsgs(fc, layerId = 'earthquakes') {
  const out = []
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {}; const g = f.geometry
    if (!f.id || !g || g.type !== 'Point' || !Number.isFinite(p.time)) continue
    const mag = Number.isFinite(p.mag) ? p.mag : null
    out.push(obs(layerId, 'USGS', `${p.title || p.place || 'Earthquake'} [${f.id}]`,
      { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] }, new Date(p.time).toISOString(), null,
      { original: p, depthKm: g.coordinates[2] ?? null, size: mag == null ? 6 : Math.max(4, Math.min(22, mag * 2.4)) }))
  }
  return out
}

export function normalizeEonet(json, layerId) {
  const out = []
  for (const ev of json?.events ?? []) {
    for (const [i, g] of (ev.geometry ?? []).entries()) {
      const ts = toIsoUtc(g.date)
      if (!ts || !g.coordinates || (g.type !== 'Point' && g.type !== 'Polygon')) continue
      const geom = g.type === 'Point' ? { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] } : { type: 'Polygon', coordinates: g.coordinates }
      out.push(obs(layerId, 'NASA EONET', `${ev.title} [${ev.id}#${i}]`, geom, ts, null,
        { original: { id: ev.id, title: ev.title, link: ev.link, sources: ev.sources, closed: ev.closed, magnitude: g.magnitudeValue, unit: g.magnitudeUnit }, size: 9 }))
    }
  }
  return out
}

/** Fetch real events for one registry layer between two UTC ms values. Throws on HTTP/network errors. */
export async function fetchHazards(layerId, startMs, endMs, { signal } = {}) {
  const def = HAZARD_SOURCES[layerId]
  if (!def) throw new Error(`No data source for layer ${layerId}`)
  let url
  if (layerId === 'earthquakes') {
    url = `${USGS}/query?format=geojson&starttime=${day(startMs)}&endtime=${day(endMs + 86400e3)}&minmagnitude=4.5&orderby=time&limit=3000`
  } else {
    url = `${EONET}/events?status=all&category=${def.eonet}&start=${day(startMs)}&end=${day(endMs)}&limit=1000`
  }
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`${def.source} returned HTTP ${r.status}`)
  const json = await r.json()
  const observations = layerId === 'earthquakes' ? normalizeUsgs(json, layerId) : normalizeEonet(json, layerId)
  return { observations, source: def.source, retrievedAt: new Date().toISOString() }
}
