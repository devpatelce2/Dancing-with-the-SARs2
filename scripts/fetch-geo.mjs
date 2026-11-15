// Downloads raw Natural Earth GeoJSON (public domain) from the nvkelso/natural-earth-vector mirror.
import { mkdirSync, writeFileSync } from 'node:fs';
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
mkdirSync('public/data/geo', { recursive: true });
for (const n of ['ne_50m_admin_0_countries', 'ne_110m_geography_marine_polys']) {
  const res = await fetch(`${base}/${n}.geojson`);
  if (!res.ok) throw new Error(`${n}: HTTP ${res.status}`);
  writeFileSync(`public/data/geo/${n}.geojson`, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', n);
}
