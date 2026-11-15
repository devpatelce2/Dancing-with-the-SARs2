// Adapter: ASF DAAC search results (Sentinel-1, NISAR) -> normalized Observation.
// STATUS: written against the documented asf_search / Vertex GeoJSON property names
// (sceneName, platform, flightDirection, polarization, processingLevel, startTime, stopTime, fileID, ...).
// NOT yet exercised against a live ASF response in this environment — see docs/BUILD_LOG.md.
import { toIsoUtc } from '../schema.js';

const MISSIONS = [
  { test: (p) => /^S1[A-D]?_|SENTINEL/i.test(`${p.sceneName ?? ''}${p.platform ?? ''}`), mission: 'SENTINEL-1', layerId: 'sentinel1' },
  { test: (p) => /NISAR/i.test(`${p.sceneName ?? ''}${p.platform ?? ''}${p.fileID ?? ''}`), mission: 'NISAR', layerId: 'nisar' },
];

export const asfAdapter = {
  id: 'asf',
  /** true when the FeatureCollection looks like ASF output */
  canHandle(fc) {
    const p = fc?.features?.[0]?.properties;
    return !!p && ('sceneName' in p || 'fileID' in p) && ('startTime' in p || 'stopTime' in p);
  },
  normalize(fc, { verification = 'user-supplied', sourceLabel = 'ASF DAAC' } = {}) {
    const out = []; const skipped = [];
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      const m = MISSIONS.find((x) => x.test(p));
      const ts = toIsoUtc(p.startTime);
      const productId = p.sceneName ?? p.fileID ?? p.granuleName;
      if (!m || !ts || !f.geometry || !productId) { skipped.push({ productId, reason: !m ? 'unknown mission' : !ts ? 'no startTime' : !f.geometry ? 'no geometry' : 'no id' }); continue; }
      out.push({
        type: 'Feature', id: `${m.mission}:${productId}`, geometry: f.geometry,
        properties: {
          layerId: m.layerId, kind: 'satellite', category: 'sar-acquisition', mission: m.mission,
          platform: p.platform ?? null, productId, productType: p.processingLevel ?? p.productType ?? null,
          timestamp: ts, endTimestamp: toIsoUtc(p.stopTime),
          orbitDirection: p.flightDirection ? String(p.flightDirection).toUpperCase() : null,
          polarization: p.polarization ?? null, source: sourceLabel, verificationStatus: verification,
          metadata: {
            beamMode: p.beamModeType ?? p.beamMode ?? null, pathNumber: p.pathNumber ?? null, frameNumber: p.frameNumber ?? null,
            url: p.url ?? null, bytes: p.bytes ?? null, original: p,
          },
        },
      });
    }
    return { observations: out, skipped };
  },
};
