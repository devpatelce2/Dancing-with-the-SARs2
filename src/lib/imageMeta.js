// Source attribution and metadata for every radar image drawn on the map. Pure functions so they can be tested.
// Everything is read from the processed timeseries.json; nothing here is invented.

const MISSIONS = {
  NISAR: { name: 'NISAR', agency: 'NASA–ISRO', band: 'L-band', credit: 'NISAR data: NASA and ISRO, distributed by ASF DAAC. Processed by Team Stellaris.' },
  'SENTINEL-1': { name: 'Sentinel-1', agency: 'ESA (Copernicus)', band: 'C-band', credit: 'Contains modified Copernicus Sentinel data (ESA), distributed by ASF DAAC. Processed by Team Stellaris.' },
}

const KINDS = {
  overlay: 'Change candidates: pixels at least the threshold darker than the baseline',
  image: 'Backscatter brightness in dB, shown in greyscale',
  diff: 'Change versus baseline in dB (blue darker, orange brighter)',
}

const utc = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'unknown' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` }

/**
 * @param ts     parsed timeseries.json
 * @param point  one entry of ts.points
 * @param kind   'overlay' | 'image' | 'diff'
 */
export function imageMeta(ts, point, kind = 'overlay') {
  const m = MISSIONS[ts?.mission] ?? { name: ts?.mission ?? 'unknown mission', agency: 'unknown', band: '', credit: 'Source: see the site documentation.' }
  const meth = ts?.method ?? {}
  const v = ts?.validation
  const rows = [
    ['Shows', KINDS[kind] ?? KINDS.overlay],
    ['Satellite', `${m.name}${m.band ? `, ${m.band} radar` : ''} (${m.agency})`],
    ['Product', [ts?.productType, ts?.polarization, ts?.frequency].filter(Boolean).join(' · ') || 'not recorded'],
    ['Acquired', utc(point?.time)],
    ['Pass', [ts?.track && `track ${ts.track}`, ts?.direction && (ts.direction === 'D' ? 'descending' : ts.direction === 'A' ? 'ascending' : ts.direction), ts?.frame && `frame ${ts.frame}`, point?.cycle && `cycle ${point.cycle}`].filter(Boolean).join(', ') || 'not recorded'],
    ['Scene ID', point?.productId ?? 'not recorded'],
    ['Processing', `${meth.speckleWindow ? `${meth.speckleWindow}-pixel averaging, ` : ''}${Number.isFinite(meth.thresholdDb) ? `threshold ${meth.thresholdDb} dB, ` : ''}${meth.baselineScenes ? `baseline of ${meth.baselineScenes} earlier scenes` : 'baseline per site file'}`],
    ['Footprint', ts?.bounds ? `${ts.bounds.map((x) => Number(x).toFixed(3)).join(', ')} (W, S, E, N)${ts.processingCrs ? ` · processed in ${ts.processingCrs}` : ''}` : 'not recorded'],
    ['Credit', m.credit],
    ['Status', ts?.synthetic ? 'SYNTHETIC demonstration data, not an observation.' : v ? `Compared with an independent reference: see the validation box (${v.reference?.name ?? 'reference'}).` : 'Candidates only: not confirmed on the ground and not validated against an independent reference.'],
  ]
  return {
    id: `${ts?.siteId ?? 'site'}:${point?.productId ?? point?.time}:${kind}`,
    title: `${m.name} · ${utc(point?.time)}`,
    synthetic: !!ts?.synthetic,
    rows,
  }
}

export const IMAGE_META_REQUIRED_ROWS = ['Shows', 'Satellite', 'Product', 'Acquired', 'Pass', 'Scene ID', 'Processing', 'Footprint', 'Credit', 'Status']
