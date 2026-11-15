// Data contract for processed time series (written by pipeline/run_timeseries.py, read by the frontend).
//   public/data/sites.json                     -> { sites: [{ id, name, kind: 'timeseries' }] }
//   public/data/<site_id>/timeseries.json      -> validated by validateTimeSeries()
//   public/data/<site_id>/ts/<YYYYMMDDTHHMMSS>.png  -> per-date change-candidate overlay (bounds = timeseries.bounds)
// Every number shown in the UI comes from timeseries.json. Nothing here invents values.
import { validateBounds } from './siteData.js'

const SITE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const nullableNum = (v) => v === null || v === undefined || isNum(v)

export function validateTimeSeries(t) {
  const errors = []
  const need = (c, m) => { if (!c) errors.push(m) }
  need(t && typeof t === 'object', 'timeseries is not an object')
  if (errors.length) return { ok: false, errors }
  need(t.schemaVersion === 1, 'schemaVersion must be 1')
  need(SITE_ID.test(t.siteId ?? ''), 'siteId invalid')
  need(typeof t.eventName === 'string' && t.eventName.length > 0, 'eventName missing')
  need(t.mission === 'NISAR' || t.mission === 'SENTINEL-1', 'mission must be NISAR or SENTINEL-1')
  need(typeof t.polarization === 'string' && t.polarization.length > 0, 'polarization missing')
  need(t.bounds == null || validateBounds(t.bounds), 'bounds must be [W,S,E,N] degrees')
  need(t.method && isNum(t.method.thresholdDb), 'method.thresholdDb missing')
  need(t.baseline && typeof t.baseline === 'object', 'baseline missing')
  need(Array.isArray(t.limitations) && t.limitations.length > 0, 'limitations must list at least one entry')
  need(Array.isArray(t.points) && t.points.length >= 3, 'points must hold at least 3 scenes')
  let prev = -Infinity
  ;(t.points ?? []).forEach((p, i) => {
    need(p && isIso(p.time), `points[${i}].time invalid`)
    if (p && isIso(p.time)) { const ms = Date.parse(p.time); need(ms >= prev, `points[${i}] not in time order`); prev = ms }
    need(p && typeof p.productId === 'string' && p.productId.length > 0, `points[${i}].productId missing`)
    need(p && nullableNum(p.meanDb) && nullableNum(p.deltaDb) && nullableNum(p.z), `points[${i}] stats must be numbers or null`)
    need(p && isNum(p.changedAreaKm2) && p.changedAreaKm2 >= 0, `points[${i}].changedAreaKm2 missing`)
    need(!p?.overlay || (typeof p.overlay === 'string' && /^ts\/[A-Za-z0-9_.-]+\.png$/.test(p.overlay)), `points[${i}].overlay invalid`)
    need(!p?.image || (typeof p.image === 'string' && /^ts\/[A-Za-z0-9_.-]+\.png$/.test(p.image)), `points[${i}].image invalid`)
  })
  need(t.synthetic == null || typeof t.synthetic === 'boolean', 'synthetic must be a boolean')
  if (t.validation != null) need(typeof t.validation.method === 'string' && typeof t.validation.reference === 'string', 'validation needs method and reference')
  return { ok: errors.length === 0, errors }
}

export async function loadTimeSeries({ base = '/data', fetchImpl = fetch, signal } = {}) {
  let idx
  try {
    const r = await fetchImpl(`${base}/sites.json`, { signal })
    if (!r.ok) return { series: [], invalid: [], reason: `sites.json not found (HTTP ${r.status})` }
    idx = await r.json()
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    return { series: [], invalid: [], reason: `sites.json unreadable: ${e.message}` }
  }
  const entries = (Array.isArray(idx?.sites) ? idx.sites : []).filter((s) => s?.kind === 'timeseries')
  const series = []; const invalid = []
  // all sites are fetched at the same time (the list keeps the index order)
  const results = await Promise.all(entries.map(async (e) => {
    try {
      if (!SITE_ID.test(e?.id ?? '')) throw new Error('bad site id')
      const r = await fetchImpl(`${base}/${e.id}/timeseries.json`, { signal })
      if (!r.ok) throw new Error(`timeseries.json HTTP ${r.status}`)
      const ts = await r.json(); const v = validateTimeSeries(ts)
      if (!v.ok) throw new Error(v.errors.slice(0, 4).join('; '))
      return { ok: { id: e.id, base: `${base}/${e.id}`, ts } }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      return { bad: { id: e?.id ?? null, error: err.message } }
    }
  }))
  for (const r of results) { if (r.ok) series.push(r.ok); else invalid.push(r.bad) }
  return { series, invalid, reason: series.length ? null : entries.length ? 'All listed time series failed validation' : 'No time series have been processed yet' }
}

// ---- chart helpers (pure; unit-tested) ----
export function linearScale(d0, d1, r0, r1) {
  const span = d1 - d0
  return (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))
}

export function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step)
  return out
}

/** Domains for the two plots. dB domain covers points and the +-2 sigma baseline band; area domain starts at 0. */
export function seriesExtent(ts) {
  const times = ts.points.map((p) => Date.parse(p.time))
  const db = ts.points.map((p) => p.meanDb).filter(isNum)
  const b = ts.baseline ?? {}
  if (isNum(b.meanDb)) { const s = isNum(b.stdDb) ? 2 * b.stdDb : 0; db.push(b.meanDb - s, b.meanDb + s) }
  let dbMin = db.length ? Math.min(...db) : -20; let dbMax = db.length ? Math.max(...db) : 0
  const pad = Math.max((dbMax - dbMin) * 0.15, 0.25); dbMin -= pad; dbMax += pad
  const areaMax = Math.max(...ts.points.map((p) => p.changedAreaKm2), 0)
  const t0 = Math.min(...times); const t1 = Math.max(...times); const tpad = Math.max((t1 - t0) * 0.04, 3600e3)
  return { t0: t0 - tpad, t1: t1 + tpad, dbMin, dbMax, areaMin: 0, areaMax: areaMax > 0 ? areaMax * 1.12 : 1 }
}

/** Point is flagged as an outlier vs baseline only when a z-score exists (>= 3 baseline scenes). */
export const isOutlier = (p) => isNum(p.z) && Math.abs(p.z) >= 3

export const fmt = (v, d = 2, unit = '') => {
  if (!isNum(v)) return '—'
  const s = v.toFixed(d)
  return `${/^-0(\.0*)?$/.test(s) ? s.slice(1) : s}${unit}` // no negative zero
}
export const fmtDate = (iso) => new Date(iso).toISOString().slice(0, 10)

// ---- compare helpers (pure; unit-tested) ----
/** Default pair: A = last baseline scene (or first scene), B = scene with the largest changed area after A (or last scene). */
export function defaultCompare(ts) {
  const pts = ts.points
  let a = 0
  pts.forEach((p, i) => { if (p.isBaseline) a = i })
  if (a >= pts.length - 1) a = 0
  let b = pts.length - 1; let best = -1
  for (let i = a + 1; i < pts.length; i++) if (pts[i].changedAreaKm2 > best) { best = pts[i].changedAreaKm2; b = i }
  return { a, b }
}

const diff = (x, y) => (isNum(x) && isNum(y) ? y - x : null)
/** Rows for the A-vs-B table. Every value comes from timeseries.json; delta = B - A; null when either side is missing. */
export function compareRows(a, b) {
  return [
    { key: 'meanDb', label: 'Mean backscatter', unit: ' dB', d: 2, a: a.meanDb, b: b.meanDb, delta: diff(a.meanDb, b.meanDb) },
    { key: 'deltaDb', label: 'vs baseline', unit: ' dB', d: 2, a: a.deltaDb, b: b.deltaDb, delta: diff(a.deltaDb, b.deltaDb) },
    { key: 'changedAreaKm2', label: 'Change candidates', unit: ' km²', d: 1, a: a.changedAreaKm2, b: b.changedAreaKm2, delta: diff(a.changedAreaKm2, b.changedAreaKm2) },
    { key: 'changedPercent', label: 'Share of area', unit: '%', d: 1, a: a.changedPercent, b: b.changedPercent, delta: diff(a.changedPercent, b.changedPercent) },
    { key: 'validCoverage', label: 'Valid coverage', unit: '%', d: 1, a: isNum(a.validCoverage) ? 100 * a.validCoverage : null, b: isNum(b.validCoverage) ? 100 * b.validCoverage : null, delta: null },
  ]
}
export const daysBetween = (a, b) => (Date.parse(b.time) - Date.parse(a.time)) / 86400e3
export const fmtSigned = (v, d = 2, unit = '') => (isNum(v) ? `${v > 0 && fmt(v, d) !== fmt(0, d) ? '+' : ''}${fmt(v, d, unit)}` : '—')
export const clamp01 = (v, lo = 0.02, hi = 0.98) => Math.min(hi, Math.max(lo, v))

// ---- validation (written by `python -m pipeline.validate`) ----
const pct = (v) => (isNum(v) ? `${(100 * v).toFixed(0)}%` : 'n/a')
/** Display rows for a validation block, or null when the site has not been validated. Every value comes from the file. */
export function validationSummary(v) {
  if (!v || typeof v !== 'object' || !v.metrics) return null
  const m = v.metrics
  return {
    reference: v.reference, sarDate: v.sarDate ?? null, referenceDate: v.referenceDate ?? null, daysApart: isNum(v.daysApart) ? v.daysApart : null,
    compared: v.compared ?? null, caveats: Array.isArray(v.caveats) ? v.caveats : [],
    rows: [
      { k: 'Precision', v: pct(m.precision), tip: 'Of the candidate pixels, the share the reference also marks as water' },
      { k: 'Recall', v: pct(m.recall), tip: 'Of the reference water pixels, the share found as candidates' },
      { k: 'F1', v: isNum(m.f1) ? m.f1.toFixed(2) : 'n/a', tip: 'Balance of precision and recall (1 = perfect agreement)' },
      { k: 'IoU', v: isNum(m.iou) ? m.iou.toFixed(2) : 'n/a', tip: 'Overlap divided by union of the two maps' },
    ],
    pixels: isNum(m.pixelsCompared) ? m.pixelsCompared : null,
  }
}

// ---- story (pure; unit-tested). Every number comes from timeseries.json so the story can never disagree with the charts. ----
export function boundsAreaKm2(b) {
  if (!validateBounds(b)) return null
  const midLat = ((b[1] + b[3]) / 2) * Math.PI / 180
  return (b[2] - b[0]) * 111.32 * Math.cos(midLat) * (b[3] - b[1]) * 110.57
}
/** Plain-language findings for a site. Sentences only state what the file contains; nothing is inferred beyond it. */
export function storyFindings(ts) {
  const pts = ts.points.filter((p) => isNum(p.meanDb)); if (pts.length < 2) return null
  const darkest = pts.reduce((a, p) => (p.meanDb < a.meanDb ? p : a)); const brightest = pts.reduce((a, p) => (p.meanDb > a.meanDb ? p : a))
  const peak = ts.points.reduce((a, p) => (p.changedAreaKm2 > a.changedAreaKm2 ? p : a)); const last = pts[pts.length - 1]
  const area = boundsAreaKm2(ts.bounds); const thr = Math.abs(ts.method?.thresholdDb ?? 3)
  const out = [`We followed ${area ? `a ${area.toFixed(0)} km² area` : 'the area'} across ${ts.points.length} ${ts.mission === 'SENTINEL-1' ? 'Sentinel-1' : 'NISAR'} passes, from ${fmtDate(ts.points[0].time)} to ${fmtDate(ts.points[ts.points.length - 1].time)}.`]
  const span = brightest.meanDb - darkest.meanDb
  out.push(`The area was darkest on ${fmtDate(darkest.time)} (${fmt(darkest.meanDb, 2)} dB) and brightest on ${fmtDate(brightest.time)} (${fmt(brightest.meanDb, 2)} dB), a difference of ${fmt(span, 2)} dB.`)
  out.push(peak.changedAreaKm2 > 0
    ? `On ${fmtDate(peak.time)}, ${fmt(peak.changedAreaKm2, 1)} km² was at least ${thr} dB darker than the reference scenes${isNum(peak.changedPercent) ? `, about ${fmt(peak.changedPercent, 1)}% of the area` : ''}.`
    : `No pixels were ${thr} dB darker than the reference scenes on any date.`)
  if (peak.isBaseline && peak.changedAreaKm2 > 0) out.push('That date is itself one of the reference scenes, so this figure understates the change.')
  if (ts.eventDate && peak.changedAreaKm2 > 0 && Date.parse(peak.time) < Date.parse(ts.eventDate)) out.push(`That date is before the event (${String(ts.eventDate).slice(0, 10)}), so the event did not cause it.`)
  const later = Date.parse(last.time) > Date.parse(brightest.time) && Date.parse(brightest.time) > Date.parse(darkest.time) // dark -> bright -> dark again
  if (later && brightest.meanDb - last.meanDb > Math.max(0.5, span / 2)) out.push(`The last pass, on ${fmtDate(last.time)}, was darker again (${fmt(last.meanDb, 2)} dB). We cannot yet explain that.`)
  out.push(ts.validation?.metrics ? `These candidates were compared with ${ts.validation.reference}.` : 'These are change candidates. They have not been checked against an independent reference map.')
  return { sentences: out, darkestIndex: ts.points.indexOf(darkest), brightestIndex: ts.points.indexOf(brightest), peakIndex: ts.points.indexOf(peak) }
}
