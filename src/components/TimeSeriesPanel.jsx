import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadTimeSeries, seriesExtent, linearScale, niceTicks, isOutlier, fmt, fmtDate, fmtSigned, defaultCompare, compareRows, daysBetween, clamp01, validationSummary } from '../lib/timeSeries.js'

const W = 470; const PL = 44; const PR = 12
const CH = { a: { top: 14, h: 118 }, b: { top: 168, h: 84 } }
const H = 286
import { createDiffSource } from '../lib/diffMap.js'
import StoryTab from './StoryTab.jsx'
import { storyFor, CASE_STUDIES } from '../content/stories.js'
import { DATA_BASE } from '../lib/dataBase.js'
let overlaySeq = 0
const diffSources = new Map() // site key -> lazy difference-map source (kept for the two most recent sites)

function diffSourceFor(key, cur) {
  if (!diffSources.has(key)) {
    diffSources.set(key, createDiffSource(cur.base, cur.ts))
    while (diffSources.size > 2) { const old = diffSources.keys().next().value; diffSources.get(old).dispose(); diffSources.delete(old) }
  }
  return diffSources.get(key)
}
const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200))

/** Red/blue difference maps, built in the browser only for the dates that are on screen; the other dates are filled in while idle. */
function useDiffMaps(cur, enabled, indices) {
  const key = cur ? `${cur.base}|${cur.ts.quality?.processedAt ?? cur.ts.points.length}` : null
  const want = indices.join(',')
  const [st, setSt] = useState({ key: null, maps: {}, error: null })
  useEffect(() => {
    if (!enabled || !key) return undefined
    let dead = false; const src = diffSourceFor(key, cur)
    const put = (i, m) => { if (!dead) setSt((s) => ({ key, error: null, maps: { ...(s.key === key ? s.maps : {}), [i]: m } })) }
    const need = indices.filter((i) => i != null)
    Promise.all(need.map((i) => src.get(i).then((m) => put(i, m)))).then(() => {
      if (dead) return
      const rest = cur.ts.points.map((_, i) => i).filter((i) => !need.includes(i))
      const next = () => { if (dead || !rest.length) return; const i = rest.shift(); src.get(i).then((m) => { put(i, m); idle(next) }).catch(() => {}) }
      idle(next)
    }).catch((e) => { if (!dead) setSt({ key, maps: {}, error: e.message }) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, want])
  const maps = st.key === key ? st.maps : {}
  return { maps, error: st.key === key ? st.error : null, loading: enabled && !st.error && indices.some((i) => i != null && !maps[i]) }
}

function DiffKey({ thr, a, b }) {
  return (
    <div className="diff-key">
      <div className="bar" aria-hidden="true" />
      <div className="ends"><span>darker than baseline</span><span>no change</span><span>brighter</span></div>
      <p><b className="red">Red</b>: at least {thr} dB darker than the baseline scenes. Smooth open water and flooded bare ground look like this.
        {' '}<b className="blue">Blue</b>: at least {thr} dB brighter. Flooded crops or trees, wet soil and growing crops look like this, so blue next to a river can also be flood.
        {' '}Fainter colour means a smaller change.</p>
      {a && b && <p className="diff-stats">A: red {a.darkPct.toFixed(1)}% · blue {a.brightPct.toFixed(1)}% &nbsp;|&nbsp; B: red {b.darkPct.toFixed(1)}% · blue {b.brightPct.toFixed(1)}% of valid pixels</p>}
    </div>
  )
}

/** Shows georeferenced overlays on the map. When the selection changes, the new images are added first and the old ones are
 *  removed only once the new ones are ready, so the map never blinks empty between two dates. */
function useOverlays(engineRef, ready, specs, key) {
  const live = useRef([]); const run = useRef(0)
  useEffect(() => {
    const rasters = engineRef?.current?.rasters
    if (!ready || !rasters) return undefined
    const mine = ++run.current
    const drop = (ids) => ids.forEach((id) => rasters.remove(id))
    if (!specs.length) { drop(live.current); live.current = []; return undefined }
    const ids = []
    Promise.allSettled(specs.map((sp) => {
      const id = `${sp.id}-${++overlaySeq}`; ids.push(id)
      return rasters.add({ ...sp, id }).then(() => {
        if (sp.split) rasters.setSplit(id, sp.split)
        if (sp.alpha != null) rasters.setAlpha(id, sp.alpha)
      }).catch((e) => console.warn('overlay failed', sp.url, e))
    })).then(() => {
      if (run.current !== mine) { drop(ids); return } // a newer selection took over while these were loading
      drop(live.current); live.current = ids
    })
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineRef, ready, key])
  useEffect(() => () => { // panel closed or page left: clear everything, including images still loading
    run.current++
    const rasters = engineRef?.current?.rasters; if (rasters) live.current.forEach((id) => rasters.remove(id)); live.current = []
  }, [engineRef])
}

/** Warm the browser cache with a site's per-date pictures while idle, so stepping through dates is instant. */
function usePrefetch(cur) {
  useEffect(() => {
    if (!cur) return undefined
    let dead = false
    const urls = cur.ts.points.flatMap((p) => [p.image, p.overlay]).filter(Boolean).map((u) => `${cur.base}/${u}`)
    const next = () => { if (dead || !urls.length) return; const im = new Image(); im.onload = im.onerror = () => idle(next); im.src = urls.shift() }
    idle(next)
    return () => { dead = true }
  }, [cur])
}

function Chart({ ts, selected, onSelect, marks }) {
  const ex = useMemo(() => seriesExtent(ts), [ts])
  const x = linearScale(ex.t0, ex.t1, PL, W - PR)
  const ya = linearScale(ex.dbMin, ex.dbMax, CH.a.top + CH.a.h, CH.a.top)
  const yb = linearScale(ex.areaMin, ex.areaMax, CH.b.top + CH.b.h, CH.b.top)
  const pts = ts.points
  const line = (key, y) => pts.filter((p) => p[key] != null).map((p) => `${x(Date.parse(p.time)).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const b = ts.baseline
  const evX = ts.eventDate ? x(Date.parse(ts.eventDate)) : null
  const tTicks = niceTicks(ex.t0, ex.t1, 4).filter((t) => t >= ex.t0 && t <= ex.t1)
  const markOf = (i) => (marks ? (i === marks.a ? 'A' : i === marks.b ? 'B' : null) : null)
  const dot = (p, i, y, key) => {
    const cx = x(Date.parse(p.time)); const cy = y(p[key]); const mk = markOf(i); const sel = marks ? !!mk : i === selected
    const cls = `ts-dot${p.isBaseline ? ' base' : ''}${isOutlier(p) ? ' out' : ''}${sel ? ' sel' : ''}`
    return (
      <g key={`${key}${i}`}>
        {sel && <circle cx={cx} cy={cy} r="9" className={`ts-ring${mk ? ` m${mk}` : ''}`} />}
        {mk && key === 'meanDb' && <text x={cx} y={cy - 13} className={`ts-mark m${mk}`} textAnchor="middle">{mk}</text>}
        <circle cx={cx} cy={cy} r="4.6" className={cls} tabIndex={0} role="button" onClick={(e) => onSelect(i, e.shiftKey)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i, e.shiftKey) } }}
          aria-label={`${fmtDate(p.time)}: ${key === 'meanDb' ? fmt(p.meanDb, 2, ' dB') : fmt(p.changedAreaKm2, 2, ' km²')}`}>
          <title>{`${fmtDate(p.time)} · ${fmt(p.meanDb, 2, ' dB')} · ${fmt(p.changedAreaKm2, 1, ' km²')}${p.isBaseline ? ' · baseline' : ''}`}</title>
        </circle>
      </g>
    )
  }
  return (
    <svg className="ts-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dotted time series of backscatter and changed area">
      <text x={PL} y="9" className="ts-ttl">Mean backscatter (dB)</text>
      {niceTicks(ex.dbMin, ex.dbMax, 4).map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={ya(v)} y2={ya(v)} className="ts-grid" /><text x={PL - 6} y={ya(v) + 3} className="ts-tick" textAnchor="end">{v.toFixed(1)}</text></g>)}
      {b?.meanDb != null && b?.stdDb != null && <rect x={PL} width={W - PL - PR} y={ya(b.meanDb + 2 * b.stdDb)} height={Math.max(1, ya(b.meanDb - 2 * b.stdDb) - ya(b.meanDb + 2 * b.stdDb))} className="ts-band"><title>Baseline mean ± 2σ</title></rect>}
      {b?.meanDb != null && <line x1={PL} x2={W - PR} y1={ya(b.meanDb)} y2={ya(b.meanDb)} className="ts-base" />}
      {evX != null && <g><line x1={evX} x2={evX} y1={CH.a.top} y2={CH.b.top + CH.b.h} className="ts-event" /><text x={evX + 3} y={CH.a.top + CH.a.h - 3} className="ts-tick">event</text></g>}
      <polyline points={line('meanDb', ya)} className="ts-line" />
      {pts.map((p, i) => p.meanDb != null && dot(p, i, ya, 'meanDb'))}

      <text x={PL} y={CH.b.top - 8} className="ts-ttl">Change candidates (km² vs baseline)</text>
      {niceTicks(ex.areaMin, ex.areaMax, 3).map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={yb(v)} y2={yb(v)} className="ts-grid" /><text x={PL - 6} y={yb(v) + 3} className="ts-tick" textAnchor="end">{v >= 100 ? v.toFixed(0) : v.toFixed(1)}</text></g>)}
      {pts.map((p, i) => <line key={`s${i}`} x1={x(Date.parse(p.time))} x2={x(Date.parse(p.time))} y1={yb(0)} y2={yb(p.changedAreaKm2)} className="ts-stem" />)}
      <polyline points={line('changedAreaKm2', yb)} className="ts-line area" />
      {pts.map((p, i) => dot(p, i, yb, 'changedAreaKm2'))}
      {tTicks.map((t) => <text key={t} x={x(t)} y={H - 6} className="ts-tick" textAnchor="middle">{new Date(t).toISOString().slice(5, 10)}</text>)}
    </svg>
  )
}

const SCORE_HELP = [
  ['Precision', 'Of the pixels we flagged, the share the reference also marks. 80% means 8 in 10 flagged pixels agree; the other 2 are possible false alarms.'],
  ['Recall', 'Of the pixels the reference marks, the share we found. 60% means we missed 4 in 10.'],
  ['F1', 'One number that balances precision and recall, from 0 to 1. It is only high when both are high.'],
  ['IoU', 'Overlap of the two maps divided by their combined area, from 0 to 1. It is stricter than F1.'],
]
function ScoreHelp() {
  return (
    <details className="ts-help">
      <summary>What do these scores mean?</summary>
      <dl>{SCORE_HELP.map(([k, d]) => <React.Fragment key={k}><dt>{k}</dt><dd>{d}</dd></React.Fragment>)}</dl>
      <p>A score describes agreement with one reference map on one date. The reference has errors too, so a low score is a reason to look closer, not proof that either map is wrong.</p>
    </details>
  )
}
function ValidationBox({ v, siteId }) {
  if (!v) return (
    <div className="ts-val none">
      <b>No validation scores yet.</b> These candidates have not been compared with an independent reference map, so we show no accuracy numbers.
      To add them, run this with a real water or flood map for one of the dates:
      <code>python -m pipeline.validate --site-dir public/data/{siteId} --sar-date YYYY-MM-DD --reference ref.tif --name "…" --source "…" --date YYYY-MM-DD</code>
      <ScoreHelp />
    </div>
  )
  return (
    <div className="ts-val">
      <b>Checked against: {v.reference}</b>
      <span className="ts-meta">SAR {v.sarDate ?? '—'} vs reference {v.referenceDate ?? '—'}{v.daysApart != null ? ` (${v.daysApart} day${v.daysApart === 1 ? '' : 's'} apart)` : ''}{v.pixels != null ? ` · ${v.pixels.toLocaleString()} pixels` : ''}</span>
      <div className="ts-grid4">{v.rows.map((r) => <Stat key={r.k} k={r.k} v={r.v} tip={r.tip} />)}</div>
      {v.compared && <span className="ts-meta">Compared: {v.compared}.</span>}
      <ScoreHelp />
      {v.caveats.length > 0 && <ul className="ts-lim">{v.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
    </div>
  )
}

function Stat({ k, v, tip }) { return <div className="ts-stat" title={tip}><span>{k}</span><b>{v}</b></div> }

/** Draggable vertical divider over the map: A is drawn left of it, B right of it. */
function Divider({ split, setSplit, a, b }) {
  const el = useRef(null)
  const move = (e) => { const r = el.current?.parentElement?.getBoundingClientRect(); if (r?.width) setSplit(clamp01((e.clientX - r.left) / r.width)) }
  const down = (e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); move(e) }
  const drag = (e) => { if (e.buttons || e.pointerType === 'touch') move(e) }
  const key = (e) => { if (e.key === 'ArrowLeft') setSplit((s) => clamp01(s - 0.02)); else if (e.key === 'ArrowRight') setSplit((s) => clamp01(s + 0.02)) }
  return (
    <div ref={el} className="cmp-divider" style={{ left: `${split * 100}%` }} onPointerDown={down} onPointerMove={drag} onKeyDown={key}
      role="slider" tabIndex={0} aria-label="Before / after divider" aria-valuemin={2} aria-valuemax={98} aria-valuenow={Math.round(split * 100)}>
      <span className="cmp-tag a">A · {fmtDate(a.time)}</span>
      <span className="cmp-grip" aria-hidden="true">⇆</span>
      <span className="cmp-tag b">B · {fmtDate(b.time)}</span>
    </div>
  )
}

export default function TimeSeriesPanel({ engineRef, ready = true, base = DATA_BASE, open: openProp, onOpenChange }) {
  const [state, setState] = useState({ loading: true, series: [], invalid: [], reason: null })
  const [openSelf, setOpenSelf] = useState(true)
  const [wide, setWide] = useState(false) // reading width for stories and charts
  const open = openProp ?? openSelf
  const setOpen = useCallback((v) => { setOpenSelf(v); onOpenChange?.(v) }, [onOpenChange])
  const [tab, setTab] = useState('series')
  const [siteIdx, setSiteIdx] = useState(0)
  const [sel, setSel] = useState(null)
  const [pair, setPair] = useState({ a: 0, b: 0 })
  const [layer, setLayer] = useState('image')
  const [seriesLayer, setSeriesLayer] = useState('overlay')
  const [split, setSplit] = useState(0.5)
  const [showLim, setShowLim] = useState(false)
  const [overlayOn, setOverlayOn] = useState(true)
  const [frame, setFrame] = useState(0)
  const [caseOnly, setCaseOnly] = useState(null) // key of a case study opened without processed data
  const [playing, setPlaying] = useState(false)
  const panelEl = useRef(null)

  const [reloadKey, setReloadKey] = useState(0)
  const wantSite = useRef(null)
  useEffect(() => {
    const h = (e) => { wantSite.current = e.detail?.siteId ?? null; setOpen(true); setReloadKey((k) => k + 1) }
    window.addEventListener('sar-sites-updated', h); return () => window.removeEventListener('sar-sites-updated', h)
  }, [])
  useEffect(() => {
    const ac = new AbortController()
    loadTimeSeries({ base, signal: ac.signal }).then((r) => {
      if (wantSite.current) { const i = r.series.findIndex((s) => s.id === wantSite.current); if (i >= 0) setSiteIdx(i); wantSite.current = null }
      setState({ loading: false, ...r })
    }).catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, series: [], invalid: [], reason: e.message }) })
    return () => ac.abort()
  }, [base, reloadKey])

  const cur = state.series[Math.min(siteIdx, Math.max(0, state.series.length - 1))]
  const ts = cur?.ts

  const zoomTo = useCallback(() => {
    const e = engineRef?.current; if (!e || !cur?.ts.bounds) return
    const stageW = e.scene.canvas.clientWidth; const pw = panelEl.current?.offsetWidth ?? 0
    const f = e.flyToBounds(cur.ts.bounds, { insetRightPx: pw && pw < stageW - 280 ? pw + 24 : 0 })
    setSplit(clamp01(f / 2))
  }, [engineRef, cur])

  // new site: reset selections and bring it into view
  useEffect(() => {
    if (!cur) return
    setSel(cur.ts.points.length - 1); setPair(defaultCompare(cur.ts))
    setFrame(0); setPlaying(false); if (!storyFor(cur.id)) setTab((t) => (t === 'story' ? 'series' : t))
    const imgs = cur.ts.points.every((p) => p.image); setLayer(imgs ? 'diff' : 'overlay'); setSeriesLayer(imgs ? 'diff' : 'overlay')
  }, [cur])
  useEffect(() => { if (ready && cur && open) zoomTo() }, [ready, cur, open, zoomTo])

  const soloCase = caseOnly ? CASE_STUDIES.find((c) => c.key === caseOnly) : null
  const activeCase = soloCase ? soloCase.key : (tab === 'story' && cur ? CASE_STUDIES.find((c) => c.siteIds.includes(cur.id))?.key : null)
  const story = cur ? storyFor(cur.id) : null
  const inStory = tab === 'story' && !!ts && !!story && !caseOnly
  const fi = ts ? Math.min(frame, ts.points.length - 1) : 0
  // season playback: only while the Story tab is open and the user pressed Play; loops through the dates
  useEffect(() => {
    if (!inStory || !playing || !ts) return undefined
    const t = setInterval(() => setFrame((f) => (f + 1) % ts.points.length), 1700)
    return () => clearInterval(t)
  }, [inStory, playing, ts])
  useEffect(() => { if (!inStory) setPlaying(false) }, [inStory])
  const comparing = tab === 'compare' && !!ts && !caseOnly
  const pA = ts ? ts.points[Math.min(pair.a, ts.points.length - 1)] : null
  const pB = ts ? ts.points[Math.min(pair.b, ts.points.length - 1)] : null
  const hasImages = !!ts && ts.points.every((p) => p.image)
  const lay = (layer === 'image' || layer === 'diff') && !hasImages ? 'overlay' : layer
  const ia = ts ? Math.min(pair.a, ts.points.length - 1) : null, ib = ts ? Math.min(pair.b, ts.points.length - 1) : null
  const diffCompare = hasImages && comparing && lay === 'diff'
  const diffSeries = hasImages && !comparing && tab === 'series' && overlayOn && seriesLayer === 'diff' && sel != null
  const diff = useDiffMaps(cur, diffCompare || diffSeries, diffCompare ? [ia, ib] : diffSeries ? [Math.min(sel, ts.points.length - 1)] : [])
  usePrefetch(cur)

  const specs = []
  if (ts?.bounds && !soloCase) { // shown whether or not the panel is open, so sliding the panel away gives a clear view of the layer
    const src = ts.synthetic ? 'SYNTHETIC demo' : `${ts.mission === 'SENTINEL-1' ? 'Sentinel-1' : 'NISAR'} ${ts.productType ?? 'GCOV'} (processed)`
    if (comparing && pA && pB) {
      if (lay === 'diff') {
        const dA = diff.maps[ia], dB = diff.maps[ib]
        if (dA && dB) {
          specs.push({ id: 'cmp-a', url: dA.url, key: `diff-${ia}`, bounds: ts.bounds, timestamp: pA.time, source: `${src}, change vs baseline`, split: 'left', sampling: 'nearest' })
          specs.push({ id: 'cmp-b', url: dB.url, key: `diff-${ib}`, bounds: ts.bounds, timestamp: pB.time, source: `${src}, change vs baseline`, split: 'right', sampling: 'nearest' })
        }
      } else {
        const sampling = lay === 'overlay' ? 'nearest' : 'linear'
        if (pA[lay]) specs.push({ id: 'cmp-a', url: `${cur.base}/${pA[lay]}`, bounds: ts.bounds, timestamp: pA.time, source: src, split: 'left', sampling })
        if (pB[lay]) specs.push({ id: 'cmp-b', url: `${cur.base}/${pB[lay]}`, bounds: ts.bounds, timestamp: pB.time, source: src, split: 'right', sampling })
      }
    } else if (inStory) {
      const p = ts.points[fi]; const f = hasImages ? p.image : p.overlay
      if (f) specs.push({ id: 'story', url: `${cur.base}/${f}`, bounds: ts.bounds, timestamp: p.time, source: src, sampling: hasImages ? 'linear' : 'nearest' })
    } else if (tab === 'series' && overlayOn && sel != null) {
      const si = Math.min(sel, ts.points.length - 1); const p = ts.points[si]; const useDiff = seriesLayer === 'diff' && hasImages
      if (useDiff && diff.maps[si]) specs.push({ id: 'ts-overlay', url: diff.maps[si].url, key: `diff-${si}`, bounds: ts.bounds, timestamp: p.time, source: `${src}, change vs baseline`, sampling: 'nearest' })
      else if (!useDiff && p.overlay) specs.push({ id: 'ts-overlay', url: `${cur.base}/${p.overlay}`, bounds: ts.bounds, timestamp: p.time, source: src, sampling: 'nearest' })
    }
  }
  useOverlays(engineRef, ready, specs, specs.map((s) => `${s.id}|${s.key ?? s.url}|${s.split ?? ''}`).join(';'))
  useEffect(() => { if (ready && comparing) engineRef?.current?.rasters?.setSplitPosition(split) }, [ready, comparing, split, engineRef])

  // One case study per kind of change. With processed data it opens the site's Story tab; without, the story alone.
  const openCase = (c) => {
    const id = c.siteIds.find((sid) => state.series.some((x) => x.id === sid)) // the main site first
    const idx = id ? state.series.findIndex((x) => x.id === id) : -1
    if (idx >= 0) { setCaseOnly(null); setSiteIdx(idx); setTab('story'); return }
    setCaseOnly(c.key); setPlaying(false)
    const e = engineRef?.current; const b = c.story.bounds
    if (e && b) { const stageW = e.scene.canvas.clientWidth; const pw = panelEl.current?.offsetWidth ?? 0; e.flyToBounds(b, { insetRightPx: pw && pw < stageW - 280 ? pw + 24 : 0 }) }
  }
  // A case study asked for from the home page (or any other part of the app): open it once the site list has loaded.
  const [wantCase, setWantCase] = useState(() => (typeof window !== 'undefined' ? window.__sarPendingCase ?? null : null))
  useEffect(() => { const h = (e) => setWantCase(e.detail?.key ?? null); window.addEventListener('sar-open-case', h); return () => window.removeEventListener('sar-open-case', h) }, [])
  useEffect(() => {
    if (!wantCase || state.loading) return
    const c = CASE_STUDIES.find((k) => k.key === wantCase); window.__sarPendingCase = null; setWantCase(null)
    if (c) { setOpen(true); openCase(c) }
  }, [wantCase, state.loading]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickDot = (i, shift) => {
    if (tab === 'story') { setPlaying(false); setFrame(i); return }
    if (tab !== 'compare') { setSel(i); return }
    setPair((p) => (shift ? { ...p, a: i } : { ...p, b: i }))
  }

  if (!open) return (<>
    {comparing && pA && pB && pair.a !== pair.b && <Divider split={split} setSplit={setSplit} a={pA} b={pB} />}
    <button className="ts-fab" onClick={() => setOpen(true)} aria-label="Show the surface-change panel" title="Show the surface-change panel"><span aria-hidden="true">‹</span> Surface change</button>
  </>)

  const p = ts && sel != null ? ts.points[Math.min(sel, ts.points.length - 1)] : null
  const mk = ts?.trend?.mannKendall; const sm = ts?.summary
  const same = pA && pB && pair.a === pair.b
  const order = pA && pB && Date.parse(pA.time) > Date.parse(pB.time)
  return (
    <>
      {comparing && pA && pB && !same && <Divider split={split} setSplit={setSplit} a={pA} b={pB} />}
      <section className={`ts-panel${wide ? ' wide' : ''}`} ref={panelEl} aria-label="Surface change">
        <header>
          <b>◔ Surface change · {ts ? (ts.mission === 'SENTINEL-1' ? 'Sentinel-1' : 'NISAR') : 'NISAR / Sentinel-1'}</b>
          <span className="ts-hbtns"><button className="ts-x" onClick={() => setWide((v) => !v)} aria-pressed={wide} aria-label={wide ? 'Make the panel narrower' : 'Make the panel wider'} title={wide ? 'Narrower panel' : 'Wider panel for reading'}>{wide ? '⇥' : '⇤'}</button>
          <button className="ts-x" onClick={() => setOpen(false)} aria-label="Hide this panel" title="Hide this panel">›</button></span>
        </header>
        {state.loading && <p className="ts-empty">Loading processed data…</p>}
        {!state.loading && <nav className="cs-row" aria-label="Case studies">
          <span>Case studies</span>
          {CASE_STUDIES.map((c) => { const has = state.series.some((x) => c.siteIds.includes(x.id)); return (
            <button key={c.key} className={`cs ${c.key}${activeCase === c.key ? ' on' : ''}`} onClick={() => openCase(c)} aria-pressed={activeCase === c.key}
              title={`${c.story.place}${has ? '' : ' (story only: no radar data processed yet)'}`}>{c.story.label}{!has && <i aria-hidden="true">◌</i>}</button>) })}
        </nav>}
        {!state.loading && soloCase && <>
          <div className="ts-row"><span className="ts-site">{soloCase.story.place}</span><span className="ts-meta">Case study · story only{cur ? <> · <button className="cs-back" onClick={() => setCaseOnly(null)}>back to {ts.name}</button></> : null}</span></div>
          <StoryTab story={soloCase.story} ts={null} frame={0} setFrame={() => {}} playing={false} setPlaying={() => {}} hasImages={false} />
        </>}
        {!state.loading && !cur && !soloCase && (
          <div className="ts-empty">
            <p><b>No processed SAR time series yet.</b></p>
            <p>{state.reason}. Name a place and the pipeline finds a small area and real scenes for it (NISAR from late 2025, Sentinel-1 for earlier dates):</p>
            <code>python -m pipeline.quick --place "Sylhet, Bangladesh" --event "My event" --start 2026-10-01 --threshold-db -3</code>
            <p>If you already processed a site and it is missing here, run <code className="inl">python -m pipeline.rebuild_index</code>.</p>
            {state.invalid.length > 0 && <p className="err">Rejected: {state.invalid.map((i) => `${i.id}: ${i.error}`).join(' | ')}</p>}
          </div>
        )}
        {cur && ts && !soloCase && (
          <>
            {ts.synthetic && <p className="ts-synth" role="note">SYNTHETIC DEMO — generated numbers, not satellite observations</p>}
            <div className="ts-row">
              {state.series.length > 1
                ? <select value={siteIdx} onChange={(e) => { setCaseOnly(null); setSiteIdx(+e.target.value) }} aria-label="Site">{state.series.map((s, i) => <option key={s.id} value={i}>{s.ts.name}</option>)}</select>
                : <span className="ts-site">{ts.name}</span>}
              <span className="ts-meta">{ts.eventName} · Track {ts.track ?? '—'} {ts.direction ?? ''} · {ts.polarization} · {ts.points.length} scenes</span>
            </div>
            <div className="ts-tabs" role="tablist" aria-label="View">
              <button role="tab" aria-selected={tab === 'series'} className={tab === 'series' ? 'on' : ''} onClick={() => setTab('series')}>Time series</button>
              <button role="tab" aria-selected={tab === 'compare'} className={tab === 'compare' ? 'on' : ''} onClick={() => setTab('compare')}>Compare dates</button>
              {story && <button role="tab" aria-selected={tab === 'story'} className={`story${tab === 'story' ? ' on' : ''}`} onClick={() => setTab('story')}>Story</button>}
            </div>

            <Chart ts={ts} selected={inStory ? fi : sel} onSelect={pickDot} marks={tab === 'compare' ? pair : null} />
            <div className="ts-key"><span><i className="k base" />baseline scene</span><span><i className="k pt" />later scene</span><span><i className="k out" />outlier (|z| ≥ 3)</span><span><i className="k band" />baseline ±2σ</span></div>

            {tab === 'series' && <>
              {p && <div className="ts-sel">
                <b>{fmtDate(p.time)} UTC</b> · cycle {p.cycle ?? '—'} {p.isBaseline ? '· baseline' : ''}
                <div className="ts-grid2">
                  <Stat k="Mean backscatter" v={fmt(p.meanDb, 2, ' dB')} tip="Mean of linear power over valid AOI pixels, then converted to dB" />
                  <Stat k="vs baseline" v={fmtSigned(p.deltaDb, 2, ' dB')} tip="AOI mean minus baseline mean. Small if only part of the AOI changed." />
                  <Stat k="z-score" v={p.z == null ? 'n/a (<3 baseline)' : fmt(p.z, 1)} tip="Distance from baseline mean in baseline standard deviations" />
                  <Stat k="Change candidates" v={`${fmt(p.changedAreaKm2, 1, ' km²')} (${fmt(p.changedPercent, 1, '%')})`} tip={`Pixels ≥ ${Math.abs(ts.method.thresholdDb)} dB below the per-pixel baseline median, equal-area km²`} />
                </div>
              </div>}
              <div className="ts-grid2 ts-sum">
                <Stat k="Baseline" v={`${fmt(ts.baseline.meanDb, 2)} ± ${fmt(ts.baseline.stdDb, 2)} dB (n=${ts.baseline.n})`} />
                <Stat k="Largest drop" v={sm?.largestDropDb != null ? `${fmt(sm.largestDropDb, 2, ' dB')} on ${fmtDate(sm.largestDropTime)}` : '—'} />
                <Stat k="Peak change candidates" v={sm ? `${fmt(sm.peakChangedAreaKm2, 1, ' km²')} on ${fmtDate(sm.peakChangedAreaTime)}` : '—'} />
                <Stat k="Trend (Mann-Kendall)" v={mk ? `τ=${fmt(mk.tau, 2)}, p=${mk.p < 0.001 ? '<0.001' : fmt(mk.p, 3)}` : 'needs ≥ 4 scenes'} tip="Monotonic-trend test on AOI mean dB; not meaningful across an abrupt event" />
                <Stat k="Sen slope" v={ts.trend?.senSlopeDbPerDay != null ? fmtSigned(ts.trend.senSlopeDbPerDay * 12, 3, ' dB / 12 d') : '—'} />
                <Stat k="Revisit gap" v={sm ? `median ${fmt(sm.medianGapDays, 0)} d, max ${fmt(sm.maxGapDays, 0)} d` : '—'} />
              </div>
              <ValidationBox v={validationSummary(ts.validation)} siteId={cur.id} />
              <div className="ts-actions">
                <label><input type="checkbox" checked={overlayOn} onChange={(e) => setOverlayOn(e.target.checked)} /> show on map</label>
                <select value={seriesLayer} onChange={(e) => setSeriesLayer(e.target.value)} aria-label="Map layer for the selected date">
                  <option value="diff" disabled={!hasImages}>Difference vs baseline (red/blue)</option>
                  <option value="overlay">Change candidates (orange)</option>
                </select>
                <button onClick={zoomTo} disabled={!ts.bounds}>Zoom to site</button>
                <button onClick={() => setShowLim((v) => !v)} aria-expanded={showLim}>{showLim ? 'Hide' : 'Show'} limitations</button>
              </div>
            </>}

            {inStory && <StoryTab story={story} ts={ts} frame={fi} setFrame={setFrame} playing={playing} setPlaying={setPlaying} hasImages={hasImages} />}

            {tab === 'compare' && pA && pB && <div className="ts-sel">
              <div className="cmp-pick">
                <label><span className="cmp-l a">A</span> left / before
                  <select value={pair.a} onChange={(e) => setPair((q) => ({ ...q, a: +e.target.value }))} aria-label="Date A">{ts.points.map((q, i) => <option key={i} value={i}>{fmtDate(q.time)}{q.isBaseline ? ' · baseline' : ''}</option>)}</select>
                </label>
                <button className="cmp-swap" onClick={() => setPair((q) => ({ a: q.b, b: q.a }))} title="Swap A and B" aria-label="Swap A and B">⇄</button>
                <label><span className="cmp-l b">B</span> right / after
                  <select value={pair.b} onChange={(e) => setPair((q) => ({ ...q, b: +e.target.value }))} aria-label="Date B">{ts.points.map((q, i) => <option key={i} value={i}>{fmtDate(q.time)}{q.isBaseline ? ' · baseline' : ''}</option>)}</select>
                </label>
              </div>
              <div className="cmp-layer" role="group" aria-label="Map layer">
                <span>On map</span>
                <button className={lay === 'image' ? 'on' : ''} disabled={!hasImages} onClick={() => setLayer('image')} title={hasImages ? 'Radar backscatter, same grey scale on both dates' : 'Re-run the pipeline to create per-date radar images'}>Radar image</button>
                <button className={lay === 'diff' ? 'on' : ''} disabled={!hasImages} onClick={() => setLayer('diff')} title={hasImages ? 'Red = darker than baseline, blue = brighter' : 'Needs the per-date radar images; re-run the analysis'}>Difference map</button>
                <button className={lay === 'overlay' ? 'on' : ''} onClick={() => setLayer('overlay')}>Change candidates</button>
                <button onClick={zoomTo} disabled={!ts.bounds}>Zoom to site</button>
              </div>
              {lay === 'diff' && diff.loading && <p className="ts-note">Building the difference map…</p>}
              {lay === 'diff' && diff.error && <p className="ts-warn">{diff.error}</p>}
              {lay === 'diff' && !diff.error && <DiffKey thr={Math.abs(ts.method.thresholdDb)} a={diff.maps[ia]?.stats} b={diff.maps[ib]?.stats} />}
              {same && <p className="ts-warn">A and B are the same date. Pick two different dates to compare.</p>}
              {order && !same && <p className="ts-warn">A is later than B, so differences read backwards in time. Use ⇄ to swap.</p>}
              <table className="cmp-table">
                <thead><tr><th scope="col">{same ? '' : `${fmt(Math.abs(daysBetween(pA, pB)), 0)} days apart`}</th><th scope="col">A · {fmtDate(pA.time)}</th><th scope="col">B · {fmtDate(pB.time)}</th><th scope="col">B − A</th></tr></thead>
                <tbody>{compareRows(pA, pB).map((r) => <tr key={r.key}><th scope="row">{r.label}</th><td>{fmt(r.a, r.d, r.unit)}</td><td>{fmt(r.b, r.d, r.unit)}</td><td className={r.delta == null ? '' : 'd'}>{r.delta == null ? '—' : fmtSigned(r.delta, r.d, r.unit)}</td></tr>)}</tbody>
              </table>
              <p className="ts-note">Drag the ⇆ line on the map: A is left of it, B is right. Click a dot to set B, Shift+click to set A.{lay === 'diff' ? ' Both sides are compared with the same baseline, so a date inside the baseline shows almost nothing.' : lay === 'image' ? ` Darker = lower backscatter (smooth water is dark). Grey scale ${fmt(ts.visualisationStretchDb?.[0], 1)} to ${fmt(ts.visualisationStretchDb?.[1], 1, ' dB')} on both sides.` : ' Orange = pixels that dropped below the baseline by more than the threshold on that date.'}</p>
            </div>}

            <p className="ts-note">Change <b>candidates</b> from {ts.mission === 'SENTINEL-1' ? 'Sentinel-1 C-band RTC' : 'NISAR L-band GCOV'} backscatter decreases vs a baseline of {ts.baseline.n} scenes (threshold {ts.method.thresholdDb} dB, chosen by the analyst). Not confirmed events, not displacement{ts.validation ? '' : ', not independently validated'}.</p>
            {showLim && tab === 'series' && <ul className="ts-lim">{ts.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </>
        )}
      </section>
    </>
  )
}
