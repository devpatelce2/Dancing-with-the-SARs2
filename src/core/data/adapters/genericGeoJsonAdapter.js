// Fallback adapter for event-style GeoJSON (disasters or custom footprints). The caller must say which
// layer the data belongs to and which property names carry the id/time; nothing is guessed silently.
import { toIsoUtc } from '../schema.js';
export function genericGeoJsonAdapter({ layerId, kind = 'disaster', category, idProp, timeProp, endTimeProp, source, verification = 'user-supplied' }) {
  return {
    id: 'generic-geojson',
    canHandle: () => true,
    normalize(fc) {
      const observations = []; const skipped = [];
      (fc.features ?? []).forEach((f, i) => {
        const p = f.properties ?? {}; const ts = toIsoUtc(p[timeProp]); const pid = String(p[idProp] ?? f.id ?? '');
        if (!ts || !pid || !f.geometry) { skipped.push({ productId: pid || `#${i}`, reason: !ts ? `no ${timeProp}` : !pid ? 'no id' : 'no geometry' }); return; }
        observations.push({ type: 'Feature', id: `${source}:${pid}`, geometry: f.geometry, properties: {
          layerId, kind, category: category ?? layerId, mission: null, platform: null, productId: pid, productType: null,
          timestamp: ts, endTimestamp: endTimeProp ? toIsoUtc(p[endTimeProp]) : null, orbitDirection: null, polarization: null,
          source, verificationStatus: verification, metadata: { original: p } } });
      });
      return { observations, skipped };
    },
  };
}
