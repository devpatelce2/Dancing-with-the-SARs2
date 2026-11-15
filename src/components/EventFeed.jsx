import React, { useMemo } from 'react'
import { useRegistry, useStoreVersion, useTimeline } from '../ui/hooks.js'
import { featureCenter, inBounds } from '../core/geo/bounds.js'

import { describe } from '../data/describeEvent.js'
export { describe }

// Per-hazard presentation: glyph, colour comes from the layer registry.
export const GLYPH = { floods: '🌊', earthquakes: '🫨', wildfires: '🔥', cyclones: '🌀', volcanoes: '🌋', landslides: '⛰️', droughts: '☀️' }

/** Sorted list of the events currently on the map; click one to fly to it. */
export default function EventFeed({ platform, bounds, onFocus }) {
  const { registry, store, timeline } = platform
  useRegistry(registry); const ver = useStoreVersion(store); const tl = useTimeline(timeline)
  const rows = useMemo(() => {
    const win = timeline.getWindow(); const out = []
    for (const l of registry.list('disaster')) {
      if (!l.visible) continue
      for (const f of store.query({ layerId: l.id, window: win, limit: 5000 }).features) {
        const c = featureCenter(f); if (bounds && !inBounds(c, bounds)) continue
        out.push({ f, c, l, d: describe(f) })
      }
    }
    return out.sort((a, b) => (b.f.properties.metadata?.size ?? 0) - (a.f.properties.metadata?.size ?? 0) || b.d.when.localeCompare(a.d.when))
  }, [registry, store, timeline, bounds, ver, tl.time, tl.windowMs])
  if (!rows.length) return null
  return (
    <section className="event-feed">
      <h2>Events on the map <span className="count">{rows.length}</span></h2>
      <ul>{rows.slice(0, 12).map(({ f, c, l, d }) => (
        <li key={f.id}><button onClick={() => onFocus(c)} title="Show on map">
          <span className="chip" style={{ background: l.color }}>{GLYPH[l.id] ?? '•'}</span>
          <span className="ev-body"><b>{d.title}</b><small>{l.label} · {d.when}{d.bits.length ? ` · ${d.bits.join(' · ')}` : ''}</small></span>
        </button></li>))}
      </ul>
      {rows.length > 12 && <p className="note">Showing the 12 largest of {rows.length}. Zoom or filter to narrow down.</p>}
    </section>
  )
}
