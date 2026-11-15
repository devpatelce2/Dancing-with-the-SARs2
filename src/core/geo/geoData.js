// Loads Natural Earth derived GeoJSON (see scripts/build-geo.mjs). Cached; served from /data/geo.
const base = `${import.meta.env?.BASE_URL ?? '/'}data/geo`;
const cache = new Map();
const load = (name) => { if (!cache.has(name)) cache.set(name, fetch(`${base}/${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.json(); })); return cache.get(name); };
export const loadCountries = () => load('ne_50m_admin_0_countries.min.json');
export const loadMarine = () => load('marine.min.json');
