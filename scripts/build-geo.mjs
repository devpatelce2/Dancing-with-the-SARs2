// Reduces Natural Earth GeoJSON (public domain) to the properties the app uses.
// Source: https://github.com/nvkelso/natural-earth-vector (mirror of naturalearthdata.com).
// Stable id = ADM0_A3 (ISO_A3 is "-99" for France, Norway, Kosovo, ... in Natural Earth).
import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'public/data/geo'; // raw inputs come from `npm run fetch:geo`
const r = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const roundGeom = (g) => {
  const walk = (c) => (typeof c[0] === 'number' ? [r(c[0]), r(c[1])] : c.map(walk));
  return { type: g.type, coordinates: walk(g.coordinates) };
};
// ring centroid with antimeridian unwrapping (for ocean label anchors)
function labelPoint(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    let ring = p[0];
    const lons = ring.map((c) => c[0]);
    if (Math.max(...lons) - Math.min(...lons) > 180) ring = ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]);
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1], f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    a /= 2;
    if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [cx / (6 * a), cy / (6 * a)]; }
  }
  if (!best) return null;
  if (best[0] > 180) best[0] -= 360;
  return [r(best[0], 2), r(best[1], 2)];
}
function countries(name) {
  const g = JSON.parse(readFileSync(`${dir}/${name}.geojson`, 'utf8'));
  const out = { type: 'FeatureCollection', features: g.features.map((f) => {
    const p = f.properties;
    return { type: 'Feature', id: p.ADM0_A3, properties: {
      id: p.ADM0_A3, iso2: p.ISO_A2 === '-99' ? null : p.ISO_A2, name: p.NAME_EN || p.NAME,
      sovereign: p.SOVEREIGNT, type: p.TYPE, continent: p.CONTINENT, subregion: p.SUBREGION,
      labelX: p.LABEL_X, labelY: p.LABEL_Y, minLabel: p.MIN_LABEL, maxLabel: p.MAX_LABEL, rank: p.LABELRANK },
      geometry: roundGeom(f.geometry) };
  }) };
  writeFileSync(`${dir}/${name}.min.json`, JSON.stringify(out));
  console.log(name, out.features.length, 'features');
}
countries('ne_50m_admin_0_countries');
const m = JSON.parse(readFileSync(`${dir}/ne_110m_geography_marine_polys.geojson`, 'utf8'));
const marine = { type: 'FeatureCollection', features: m.features.map((f) => ({
  type: 'Feature', properties: { name: f.properties.name_en || f.properties.name, minLabel: f.properties.min_label,
    maxLabel: f.properties.max_label, kind: f.properties.featurecla, label: labelPoint(f.geometry) },
  geometry: roundGeom(f.geometry) })) };
writeFileSync(`${dir}/marine.min.json`, JSON.stringify(marine));
console.log('marine', marine.features.length, 'features;', marine.features.filter((f) => !f.properties.label).length, 'without label');
