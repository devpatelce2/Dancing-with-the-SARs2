// Pure helper: turn a hazard observation into display text.
/** One-line, human-readable description of a hazard observation (title, magnitude, depth). */
export function describe(f) {
  const m = f.properties.metadata ?? {}; const o = m.original ?? {}
  const title = (o.title || o.place || f.properties.productId || 'Event').replace(/\s*\[[^\]]*\]\s*$/, '')
  const bits = []
  if (f.properties.layerId === 'earthquakes' && Number.isFinite(o.mag)) bits.push(`M${o.mag.toFixed(1)}`)
  else if (Number.isFinite(o.magnitude)) bits.push(`${o.magnitude} ${o.unit ?? ''}`.trim())
  if (Number.isFinite(m.depthKm)) bits.push(`${m.depthKm.toFixed(0)} km deep`)
  if (o.closed === null || o.closed === undefined) { if (f.properties.source === 'NASA EONET') bits.push('ongoing') }
  return { title, bits, link: o.link || o.url || null, when: f.properties.timestamp.slice(0, 10) }
}

