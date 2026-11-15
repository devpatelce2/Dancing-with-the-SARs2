// Normalized observation/event model shared by satellite and disaster data.
// Common fields are lifted to the top level; the source record is preserved verbatim in `metadata.original`.
/** @typedef {'verified'|'user-supplied'|'test'|'unverified'} Verification */
/**
 * @typedef {Object} Observation  (a GeoJSON Feature)
 * @property {string} id                  stable, globally unique: `${source}:${productId}`
 * @property {'Feature'} type
 * @property {Object} geometry            GeoJSON geometry, WGS84 lon/lat (EPSG:4326)
 * @property {Object} properties
 * @property {string} properties.layerId  registry layer this belongs to
 * @property {'satellite'|'disaster'} properties.kind
 * @property {string} properties.category  e.g. 'sar-acquisition', 'flood'
 * @property {string} properties.mission   e.g. 'SENTINEL-1', 'NISAR' (satellite)
 * @property {string} properties.platform
 * @property {string} properties.productId
 * @property {string} properties.productType
 * @property {string} properties.timestamp  ISO 8601 UTC (start of acquisition / event time)
 * @property {string|null} properties.endTimestamp
 * @property {string|null} properties.orbitDirection  'ASCENDING'|'DESCENDING'|null
 * @property {string|null} properties.polarization
 * @property {string} properties.source     provenance, e.g. 'ASF DAAC'
 * @property {Verification} properties.verificationStatus
 * @property {Object} properties.metadata   mission-specific fields; `original` = untouched source properties
 */
export const VERIFICATION = ['verified', 'user-supplied', 'test', 'unverified'];

export function toIsoUtc(v) {
  if (v == null || v === '') return null;
  const s = typeof v === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? `${v}Z` : v; // treat zone-less as UTC
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Throws if the feature is unusable; returns it unchanged otherwise. */
export function assertObservation(f) {
  const p = f?.properties;
  if (f?.type !== 'Feature' || !f.geometry || !p) throw new Error('Observation must be a GeoJSON Feature with geometry');
  for (const k of ['id', 'layerId', 'kind', 'timestamp', 'source', 'verificationStatus']) {
    if (!(k === 'id' ? f.id : p[k])) throw new Error(`Observation missing ${k}`);
  }
  if (Number.isNaN(Date.parse(p.timestamp))) throw new Error('Observation timestamp is not ISO 8601');
  if (!VERIFICATION.includes(p.verificationStatus)) throw new Error(`Unknown verificationStatus ${p.verificationStatus}`);
  return f;
}

/** Half-open overlap test of an observation against a UTC window [start, end) in ms. */
export function inWindow(f, win) {
  const a = Date.parse(f.properties.timestamp);
  const b = f.properties.endTimestamp ? Date.parse(f.properties.endTimestamp) : a;
  return a < win.end && b >= win.start;
}
