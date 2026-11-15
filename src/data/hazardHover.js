// Pure view-model for the hover card shown over hazard events (floods, earthquakes, wildfires...).
import { describe } from './describeEvent.js'
import { featureCenter } from '../core/geo/bounds.js'
import { quakeSummary } from './quakeScale.js'

export const HAZARD_GLYPH = { floods: '🌊', earthquakes: '🫨', wildfires: '🔥', cyclones: '🌀', volcanoes: '🌋', landslides: '⛰️', droughts: '☀️' }
export const HAZARD_NOUN = { floods: 'Flood event', earthquakes: 'Earthquake', wildfires: 'Wildfire', cyclones: 'Severe storm / cyclone', volcanoes: 'Volcanic activity', landslides: 'Landslide', droughts: 'Drought' }

/** One displayable item for a hazard observation. `layer` is the registry layer ({id,label,color}). */
export function hazardItem(feature, layer) {
  const d = describe(feature); const o = feature.properties.metadata?.original ?? {}
  const geom = feature.geometry?.type === 'Point' ? 'Point' : 'Area'
  const closed = o.closed ? String(o.closed).slice(0, 10) : null
  return {
    id: feature.id, layerId: layer.id, color: layer.color, glyph: HAZARD_GLYPH[layer.id] ?? '•',
    kind: HAZARD_NOUN[layer.id] ?? layer.label, title: d.title, when: d.when, bits: d.bits.filter((b) => b !== 'ongoing'),
    ongoing: feature.properties.source === 'NASA EONET' && !closed, closed, source: feature.properties.source, geometry: geom,
    center: featureCenter(feature),
    quake: layer.id === 'earthquakes' ? quakeSummary(o, feature.properties.metadata?.depthKm) : null,
  }
}

/** Resolve picked feature ids against the store; unknown ids (acquisition tiles, labels) are ignored. */
export function hazardItemsForIds(ids, store, registry) {
  const out = []
  for (const id of ids ?? []) {
    const hit = store.find(id); if (!hit) continue
    const layer = registry.get(hit.layerId); if (!layer || layer.group !== 'disaster') continue
    out.push(hazardItem(hit.feature, layer))
  }
  return out
}
