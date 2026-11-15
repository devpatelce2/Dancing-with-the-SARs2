import React from 'react'
import { fmtDate } from '../lib/timeSeries.js'

// Story charts. Two kinds, kept visibly apart:
//  1. "Published numbers": drawn only from figures in the story's listed sources (each carries its reference).
//  2. "Our radar measurements": drawn only from the site's processed timeseries.json.
// Nothing here invents, interpolates or estimates a value.

const Ref = ({ n, sources }) => { const src = sources?.[n - 1]; return src ? <a className="st-ref" href={src[1]} target="_blank" rel="noopener noreferrer" title={src[0]}>{n}</a> : null }
const Frame = ({ tag, children, note }) => (
  <figure className="sv">
    <div className={`sv-tag ${tag === 'ours' ? 'ours' : ''}`}>{tag === 'ours' ? 'Our radar measurements' : 'Published numbers'}</div>
    {children}
    {note && <figcaption>{note}</figcaption>}
  </figure>
)
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/** Flood: the haor year as a 12-month strip. Month indices are 0-based; a row may wrap past December. */
function Calendar({ viz, sources }) {
  const W = 440, L = 118, cw = (W - L - 6) / 12
  return (
    <Frame note={<>Months are approximate, as given in the sources.</>}>
      <svg viewBox={`0 0 ${W} ${40 + viz.rows.length * 30}`} role="img" aria-label="Calendar of the haor year: flood season June to October, rice planted December to January, harvested April to May">
        {MONTHS.map((m, i) => <g key={i}><rect x={L + i * cw} y="18" width={cw - 2} height={viz.rows.length * 30 + 6} rx="3" className="sv-cell" /><text x={L + i * cw + cw / 2 - 1} y="12" className="sv-ax" textAnchor="middle">{m}</text></g>)}
        {viz.rows.map(([label, a, b, cls], r) => { const y = 26 + r * 30; const segs = b > 12 ? [[a, 12], [0, b - 12]] : [[a, b]]
          return <g key={label}><text x="0" y={y + 13} className="sv-lab">{label}</text>
            {segs.map(([s, e], k) => <rect key={k} x={L + s * cw} y={y} width={(e - s) * cw - 2} height="18" rx="5" className={`sv-bar ${cls} sv-grow`} style={{ '--d': `${r * 0.15}s` }} />)}</g> })}
        {viz.marker && <g className="sv-pin"><line x1={L + viz.marker.month * cw} x2={L + viz.marker.month * cw} y1="16" y2={30 + viz.rows.length * 30} /><circle cx={L + viz.marker.month * cw} cy={30 + viz.rows.length * 30} r="3.5" /></g>}
      </svg>
      <ul className="sv-key">
        {viz.rows.map(([label, , , cls, ref]) => <li key={label}><i className={`sv-sw ${cls}`} />{label}<Ref n={ref} sources={sources} /></li>)}
        {viz.marker && <li><i className="sv-sw pin" />{viz.marker.label}<Ref n={viz.marker.ref} sources={sources} /></li>}
      </ul>
    </Frame>
  )
}

/** Earthquake: published ground displacement, up and sideways, with a person for scale. */
function Displacement({ viz, sources }) {
  const W = 440, L = 128, R = 372, sc = (R - L) / viz.max, rowH = 46
  const H = 26 + viz.rows.length * rowH
  return (
    <Frame note={<>Largest reported values, rounded as published<Ref n={viz.ref} sources={sources} />. Measured by other teams with ALOS-2 radar and GNSS, not by this app.</>}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Published ground movement: ${viz.rows.map((r) => `${r[0]} ${r[2]} metres up and ${r[3]} metres ${r[4]}`).join('; ')}`}>
        {[0, 1, 2, 3, 4].filter((v) => v <= viz.max).map((v) => <g key={v}><line x1={L + v * sc} x2={L + v * sc} y1="14" y2={H - 4} className="sv-grid" /><text x={L + v * sc} y="10" className="sv-ax" textAnchor="middle">{v} m</text></g>)}
        {viz.rows.map(([place, how, up, side, dir], i) => { const y = 22 + i * rowH; return (
          <g key={place}>
            <text x="0" y={y + 12} className="sv-lab">{place}</text><text x="0" y={y + 25} className="sv-sub">{how}</text>
            <rect x={L} y={y} width={up * sc} height="14" rx="4" className="sv-bar up sv-grow" style={{ '--d': `${i * 0.18}s` }} /><text x={L + up * sc + 6} y={y + 11} className="sv-val">{up} m up</text>
            <rect x={L} y={y + 18} width={side * sc} height="14" rx="4" className="sv-bar side sv-grow" style={{ '--d': `${i * 0.18 + 0.1}s` }} /><text x={L + side * sc + 6} y={y + 29} className="sv-val dim">{side} m {dir}</text>
          </g>) })}
      </svg>
      <div className="sv-scale" aria-label="Scale: the largest uplift, 4 metres, next to an adult 1.7 metres tall">
        <svg viewBox="0 0 120 96" aria-hidden="true">
          <line x1="8" x2="112" y1="88" y2="88" className="sv-grid" />
          <rect x="62" y="8" width="26" height="80" rx="3" className="sv-bar up sv-rise" /><text x="75" y="5" className="sv-ax" textAnchor="middle">4 m</text>
          <g className="sv-person"><circle cx="30" cy="57.5" r="4" /><path d="M30 62 V78 M30 66 l-7 7 M30 66 l7 7 M30 78 l-5 10 M30 78 l5 10" /></g><text x="30" y="49" className="sv-ax" textAnchor="middle">1.7 m</text>
        </svg>
        <p>The largest uplift was more than twice the height of an adult. A harbour floor that had been under water became dry ground.</p>
      </div>
      <ul className="sv-tiles">{viz.extra.map(([v, l, r]) => <li key={l}><b>{v}</b><span>{l}<Ref n={r} sources={sources} /></span></li>)}</ul>
    </Frame>
  )
}

/** Wildfire: area as a square, containment ring, timeline and losses. */
function Fire({ viz, sources }) {
  const side = Math.sqrt(viz.areaKm2); const C = 2 * Math.PI * 30
  return (
    <Frame note={<>Figures as reported for {viz.asOf}<Ref n={viz.ref} sources={sources} />. The square shows size only; it is not the shape of the fire.</>}>
      <div className="sv-duo">
        <div className="sv-box">
          <svg viewBox="0 0 120 96" role="img" aria-label={`${viz.areaKm2} square kilometres drawn as a square about ${side.toFixed(1)} kilometres on a side`}>
            <rect x="26" y="8" width="72" height="72" rx="3" className="sv-burn sv-pop" /><text x="62" y="49" className="sv-big" textAnchor="middle">{viz.areaKm2}</text><text x="62" y="61" className="sv-ax" textAnchor="middle">km²</text>
            <path d="M26 86 H98 M26 83 V89 M98 83 V89" className="sv-dim" /><text x="62" y="95" className="sv-ax" textAnchor="middle">≈ {side.toFixed(1)} km</text>
          </svg><span>burned area</span>
        </div>
        <div className="sv-box">
          <svg viewBox="0 0 120 96" role="img" aria-label={`${viz.contained} percent contained`}>
            <circle cx="60" cy="46" r="30" className="sv-ring-bg" /><circle cx="60" cy="46" r="30" className="sv-ring" strokeDasharray={`${C * viz.contained / 100} ${C}`} transform="rotate(-90 60 46)" />
            <text x="60" y="50" className="sv-big" textAnchor="middle">{viz.contained}%</text>
          </svg><span>contained on {viz.asOf}</span>
        </div>
      </div>
      <ol className="sv-line">{viz.timeline.map(([d, t]) => <li key={d}><b>{d}</b><span>{t}</span></li>)}</ol>
      <ul className="sv-tiles two">{viz.lost.map(([v, l]) => <li key={l}><b>{v}</b><span>{l} lost at Eagle Point<Ref n={viz.ref} sources={sources} /></span></li>)}</ul>
    </Frame>
  )
}

/** Landslide: sketch of the path with the published numbers, and the scarp counted in radar pixels. */
function Slide({ viz, sources }) {
  const px = Math.round(viz.scarpM2 / (viz.pixelM * viz.pixelM)); const cells = Array.from({ length: 100 }, (_, i) => i)
  return (
    <Frame note={<>The slope drawing is a sketch, not to scale. Pixel count = {viz.scarpM2.toLocaleString('en')} m² ÷ ({viz.pixelM} m × {viz.pixelM} m).</>}>
      <svg viewBox="0 0 440 150" role="img" aria-label={`Sketch of the landslide path: it began at about ${viz.crownM} metres and the debris ran about ${viz.runKm} kilometres`}>
        <path d="M0 150 V34 C60 30 96 44 140 74 S250 118 330 126 S420 132 440 133 V150 Z" className="sv-hill" />
        <path d="M34 36 C80 40 104 52 142 77 S250 120 330 128 S410 133 432 134" className="sv-flow" pathLength="100" />
        <circle cx="34" cy="36" r="5" className="sv-crown" /><text x="46" y="26" className="sv-lab">Crown, about {viz.crownM.toLocaleString('en')} m</text>
        <path d="M34 142 H432 M34 138 V146 M432 138 V146" className="sv-dim" /><text x="233" y="138" className="sv-val" textAnchor="middle">debris ran about {viz.runKm} km</text>
        <g className="sv-rain">{[250, 280, 310, 340, 370, 400].map((x, i) => <path key={x} d={`M${x} ${14 + (i % 2) * 8} l-5 14`} style={{ '--d': `${i * 0.2}s` }} />)}</g>
        <text x="430" y="62" className="sv-big" textAnchor="end">{viz.rainMm} mm</text><text x="430" y="76" className="sv-ax" textAnchor="end">of rain in two days</text>
      </svg>
      <ul className="sv-key"><li>Crown height<Ref n={viz.refs.crown} sources={sources} /></li><li>Run-out length<Ref n={viz.refs.run} sources={sources} /></li><li>Rainfall<Ref n={viz.refs.rain} sources={sources} /></li></ul>
      <div className="sv-scale">
        <div className="sv-pixels" role="img" aria-label={`${px} of 100 squares filled: the main scarp is about ${px} Sentinel-1 pixels`}>{cells.map((i) => <i key={i} className={i < px ? 'on' : ''} style={{ '--d': `${i * 8}ms` }} />)}</div>
        <p>The main scarp, {viz.scarpM2.toLocaleString('en')} m²<Ref n={viz.refs.scarp} sources={sources} />, is only about <b>{px} radar pixels</b> at {viz.pixelM} m. That is why a slide this size is near the limit of what a brightness comparison can show.</p>
      </div>
    </Frame>
  )
}

const VIZ = { calendar: Calendar, displacement: Displacement, fire: Fire, slide: Slide }
export function StoryViz({ kind, viz, sources }) { const V = VIZ[kind]; return V && viz ? <V viz={viz} sources={sources} /> : null }
export const hasViz = (kind) => kind in VIZ

/** Our own processed radar numbers for the site, as one chart: mean brightness on top, change candidates below. */
export function OurData({ ts, frame, onPick }) {
  const pts = ts.points.filter((p) => Number.isFinite(p.meanDb)); if (pts.length < 2) return null
  const W = 440, L = 44, R = 428, T1 = 16, B1 = 96, T2 = 118, B2 = 176
  const t = pts.map((p) => Date.parse(p.time)); const t0 = Math.min(...t), t1 = Math.max(...t)
  const x = (ms) => (t1 === t0 ? (L + R) / 2 : L + 10 + ((ms - t0) / (t1 - t0)) * (R - L - 20))
  const dbs = pts.map((p) => p.meanDb); const lo = Math.min(...dbs), hi = Math.max(...dbs); const pad = Math.max(0.15, (hi - lo) * 0.2)
  const y = (v) => B1 - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (B1 - T1)
  const areas = pts.map((p) => p.changedAreaKm2 ?? 0); const amax = Math.max(...areas, 0.001)
  const ev = ts.eventDate ? Date.parse(`${ts.eventDate}T00:00:00Z`) : null; const evIn = ev != null && ev >= t0 && ev <= t1
  const base = ts.baseline?.meanDb
  const cur = ts.points[frame]; const peak = pts[areas.indexOf(Math.max(...areas))]
  const deltas = pts.filter((p) => Number.isFinite(p.deltaDb)); const drop = deltas.length ? deltas.reduce((a, b) => (b.deltaDb < a.deltaDb ? b : a)) : null
  const days = Math.round((t1 - t0) / 86400e3)
  return (
    <Frame tag="ours" note={<>From {pts.length} {ts.mission === 'SENTINEL-1' ? 'Sentinel-1' : 'NISAR'} scenes processed by this project. Hollow dots are the reference scenes. Candidates are pixels that turned darker than the reference by the set threshold; they are not confirmed on the ground. Click a dot to show that date on the map.</>}>
      <ul className="sv-tiles four">
        <li><b>{pts.length}</b><span>radar scenes</span></li>
        <li><b>{days} d</b><span>time covered</span></li>
        <li><b>{Math.max(...areas).toFixed(1)} km²</b><span>most candidates, {fmtDate(peak.time).slice(5)}</span></li>
        <li><b>{drop ? `${drop.deltaDb.toFixed(2)} dB` : 'n/a'}</b><span>largest drop vs reference</span></li>
      </ul>
      <svg viewBox={`0 0 ${W} 196`} role="img" aria-label={`Mean radar brightness and change-candidate area for ${pts.length} dates`}>
        <text x="0" y="10" className="sv-ax">Mean brightness (dB)</text><text x="0" y={T2 - 6} className="sv-ax">Change candidates (km²)</text>
        {[lo, hi].map((v) => <g key={v}><line x1={L} x2={R} y1={y(v)} y2={y(v)} className="sv-grid" /><text x={L - 5} y={y(v) + 3} className="sv-ax" textAnchor="end">{v.toFixed(1)}</text></g>)}
        {Number.isFinite(base) && base > lo - pad && base < hi + pad && <line x1={L} x2={R} y1={y(base)} y2={y(base)} className="sv-base" />}
        <line x1={L} x2={R} y1={B2} y2={B2} className="sv-grid" /><text x={L - 5} y={T2 + 8} className="sv-ax" textAnchor="end">{amax.toFixed(1)}</text><text x={L - 5} y={B2 + 3} className="sv-ax" textAnchor="end">0</text>
        {evIn && <g className="sv-pin"><line x1={x(ev)} x2={x(ev)} y1={T1 - 4} y2={B2} /><text x={x(ev) + 4} y={T1 + 2} className="sv-ax ev">event, {fmtDate(ts.eventDate).slice(5)}</text></g>}
        <polyline points={pts.map((p, i) => `${x(t[i])},${y(p.meanDb)}`).join(' ')} className="sv-dotline" pathLength="100" />
        {pts.map((p, i) => { const on = cur === p; const bh = (areas[i] / amax) * (B2 - T2 - 8); return (
          <g key={p.time} className={`sv-pt${on ? ' on' : ''}`} onClick={() => onPick?.(ts.points.indexOf(p))} role="button" tabIndex={0} aria-label={`${fmtDate(p.time)}: ${p.meanDb.toFixed(2)} dB, ${areas[i].toFixed(1)} square kilometres`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(ts.points.indexOf(p)) } }}>
            <rect x={x(t[i]) - 14} y={T1 - 6} width="28" height={B2 - T1 + 6} className="sv-hit" />
            <rect x={x(t[i]) - 7} y={B2 - bh} width="14" height={bh} rx="2" className="sv-bar cand sv-up" style={{ '--d': `${i * 0.08}s` }} />
            <circle cx={x(t[i])} cy={y(p.meanDb)} r={on ? 6 : 4.5} className={p.isBaseline ? 'hollow' : ''} />
            <text x={x(t[i])} y="192" className="sv-ax" textAnchor="middle">{fmtDate(p.time).slice(5)}</text>
          </g>) })}
      </svg>
    </Frame>
  )
}
