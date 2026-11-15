// Point-in-polygon on GeoJSON (ray casting, holes respected) with bbox pre-check. WGS84 lon/lat.
const inRing = (x, y, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inPoly = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));
export function pointInGeometry(lon, lat, g) {
  if (!g) return false;
  if (g.type === 'Polygon') return inPoly(lon, lat, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => inPoly(lon, lat, p));
  return false;
}
export function bboxOf(g) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => (typeof c[0] === 'number' ? ((w = Math.min(w, c[0])), (e = Math.max(e, c[0])), (s = Math.min(s, c[1])), (n = Math.max(n, c[1]))) : c.forEach(walk));
  walk(g.coordinates); return [w, s, e, n];
}
export class PolygonIndex {
  constructor(features) { this.items = features.map((f) => ({ f, b: bboxOf(f.geometry) })); }
  find(lon, lat) { return this.items.filter(({ f, b }) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && pointInGeometry(lon, lat, f.geometry)).map((x) => x.f); }
}
