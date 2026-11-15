// Small helpers for the "selected area" filter. Bounds are [W, S, E, N] in degrees.
export function featureCenter(f) {
  const g = f.geometry
  if (g?.type === 'Point') return g.coordinates
  const ring = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : null
  if (!ring?.length) return null
  let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1] }
  return [x / ring.length, y / ring.length]
}
export const inBounds = (c, b) => !b || (c && c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3])
export const boundsAround = (lon, lat, halfDeg) => [Math.max(-180, lon - halfDeg), Math.max(-89, lat - halfDeg), Math.min(180, lon + halfDeg), Math.min(89, lat + halfDeg)]
