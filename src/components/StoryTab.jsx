import React, { useEffect, useRef } from 'react'
import { fmtDate, storyFindings } from '../lib/timeSeries.js'
import { StoryViz, OurData, hasViz } from './StoryViz.jsx'

const SAT = <g className="st-sat" transform="translate(34 14)"><rect x="-7" y="-5" width="14" height="10" rx="2" /><rect x="-24" y="-3" width="14" height="6" /><rect x="10" y="-3" width="14" height="6" /></g>
const FIGS = {
  specular: { alt: 'Radar pulse reflecting off smooth water, away from the satellite', cap: 'Open water: weak return, looks dark', chip: 'dark', lab: ['bounces away', 232, 16] },
  double: { alt: 'Radar pulse bouncing off water and a plant stem, back to the satellite', cap: 'Water under plants: strong return, looks bright', chip: 'bright', lab: ['most returns', 104, 34] },
  canopy: { alt: 'Radar pulse scattering among the branches of living trees and returning to the satellite', cap: 'Living forest: the pulse scatters among branches, strong return', chip: 'bright', lab: ['scatters in the canopy', 150, 16] },
  burnt: { alt: 'Radar pulse passing bare burnt trunks and bouncing away from the satellite', cap: 'Burnt forest: little left to scatter, weaker return, looks darker', chip: 'dark', lab: ['little comes back', 222, 16] },
  scar: { alt: 'Radar pulse hitting a bare landslide scar on a forested slope', cap: 'Landslide scar: forest replaced by bare rock and mud, the echo changes', chip: 'mid', lab: ['echo changes', 226, 16] },
  uplift: { alt: 'A coast rising out of the sea so that seabed becomes land', cap: 'Uplift: seabed becomes land, and land returns more of the pulse than calm water', chip: 'bright', lab: ['new land', 182, 58] },
}

/** Radar pulse diagrams. Pure SVG + CSS; the motion stops for people who ask their system for reduced motion. */
function PulseFigure({ kind }) {
  const f = FIGS[kind]; if (!f) return null
  const water = kind === 'specular' || kind === 'double'
  return (
    <figure className={`st-fig ${kind}`}>
      <svg viewBox="0 0 300 120" role="img" aria-label={f.alt}>
        {water && <><rect x="0" y="92" width="300" height="28" className="st-water" /><path d="M0 92 q15 -3 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0" className="st-wave" /></>}
        {kind === 'double' && <g className="st-plant"><path d="M196 92 V46" /><path d="M196 70 q12 -8 16 -20" /><path d="M196 60 q-12 -8 -15 -20" /><path d="M212 92 V56" /><path d="M212 74 q10 -6 13 -16" /></g>}
        {(kind === 'canopy' || kind === 'burnt') && <rect x="0" y="100" width="300" height="20" className="st-ground" />}
        {kind === 'canopy' && <g>{[120, 158, 196, 234].map((x, i) => <g key={x}><path d={`M${x} 100 V${66 - (i % 2) * 6}`} className="st-trunk" /><circle cx={x} cy={56 - (i % 2) * 6} r="19" className="st-crown" /></g>)}</g>}
        {kind === 'burnt' && <g>{[120, 158, 196, 234].map((x, i) => <g key={x} className="st-char"><path d={`M${x} 100 V${50 - (i % 2) * 6}`} /><path d={`M${x} ${72 - (i % 2) * 6} l9 -9`} /><path d={`M${x} ${64 - (i % 2) * 6} l-8 -8`} /></g>)}</g>}
        {kind === 'scar' && <g><path d="M70 120 L300 34 V120 Z" className="st-ground" />{[250, 272, 292].map((x) => <circle key={x} cx={x} cy={52 - (x - 250) * 0.37 - 8} r="13" className="st-crown" />)}{[96, 116].map((x) => <circle key={x} cx={x} cy={110 - (x - 70) * 0.37 - 8} r="11" className="st-crown" />)}<path d="M136 95 L236 58 L236 72 L140 108 Z" className="st-debris" />{[150, 172, 196, 216].map((x, i) => <circle key={x} cx={x} cy={96 - (x - 136) * 0.37 + (i % 2) * 5} r="2.6" className="st-rock" />)}</g>}
        {kind === 'uplift' && <g><rect x="0" y="88" width="300" height="32" className="st-water" /><path d="M0 88 q15 -3 30 0 t30 0 t30 0 t30 0 t30 0" className="st-wave" /><g className="st-rise"><path d="M150 98 L196 92 L300 60 V140 H150 Z" className="st-ground" /><path d="M150 98 L196 92" className="st-newland" /></g></g>}
        {SAT}
        {kind === 'specular' && <><path d="M40 22 L150 92" className="st-ray out" pathLength="100" /><path d="M150 92 L262 22" className="st-ray away" pathLength="100" /><path d="M150 92 L60 34" className="st-ray back weak" pathLength="100" /></>}
        {kind === 'double' && <><path d="M40 22 L150 92" className="st-ray out" pathLength="100" /><path d="M150 92 L196 62" className="st-ray hop" pathLength="100" /><path d="M196 62 L46 20" className="st-ray back strong late" pathLength="100" /></>}
        {kind === 'canopy' && <><path d="M40 22 L150 52" className="st-ray out" pathLength="100" /><path d="M150 52 L176 64 L164 44 L200 56" className="st-ray hop" pathLength="100" /><path d="M164 46 L46 20" className="st-ray back strong late" pathLength="100" /></>}
        {kind === 'burnt' && <><path d="M40 22 L170 100" className="st-ray out" pathLength="100" /><path d="M170 100 L282 30" className="st-ray away" pathLength="100" /><path d="M170 100 L62 34" className="st-ray back weak" pathLength="100" /></>}
        {kind === 'scar' && <><path d="M40 22 L186 78" className="st-ray out" pathLength="100" /><path d="M186 78 L262 14" className="st-ray away" pathLength="100" /><path d="M186 78 L50 22" className="st-ray back" pathLength="100" /></>}
        {kind === 'uplift' && <><path d="M40 22 L172 84" className="st-ray out" pathLength="100" /><path d="M172 84 L48 22" className="st-ray back strong" pathLength="100" /></>}
        <text x={f.lab[1]} y={f.lab[2]} className="st-lab">{f.lab[0]}</text>
      </svg>
      <figcaption><span className={`st-chip ${f.chip}`} />{f.cap}</figcaption>
    </figure>
  )
}

/** Season player: steps the map and the chart through the dates. Starts only when the user presses Play. */
function SeasonPlayer({ ts, frame, setFrame, playing, setPlaying, hasImages }) {
  const n = ts.points.length; const p = ts.points[frame]
  return (
    <div className="st-player" role="group" aria-label="Play through the dates">
      <button className="st-play" onClick={() => setPlaying((v) => !v)} aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play the season'}>{playing ? '❚❚' : '▶'}</button>
      <div className="st-track">
        <div className="st-date" aria-live="polite"><b>{fmtDate(p.time)}</b><span>{p.isBaseline ? 'reference scene' : 'later scene'} · {frame + 1} of {n}</span></div>
        <div className="st-dots">{ts.points.map((q, i) => (
          <button key={i} className={`st-dot${i === frame ? ' on' : ''}${i < frame ? ' past' : ''}`} onClick={() => { setPlaying(false); setFrame(i) }} aria-label={`Show ${fmtDate(q.time)}`} aria-current={i === frame} title={fmtDate(q.time)} />
        ))}</div>
      </div>
      <span className="st-hint">{hasImages ? 'radar image on the map' : 'candidates on the map'}</span>
    </div>
  )
}

const withRefs = (text, sources) => text.split(/(\[\d+\])/).map((part, i) => {
  const m = /^\[(\d+)\]$/.exec(part); if (!m) return part
  const src = sources[+m[1] - 1]; if (!src) return part
  return <a key={i} className="st-ref" href={src[1]} target="_blank" rel="noopener noreferrer" title={src[0]}>{m[1]}</a>
})

export default function StoryTab({ story, ts, frame, setFrame, playing, setPlaying, hasImages }) {
  const root = useRef(null)
  const found = ts ? storyFindings(ts) : null
  // Chapters slide in as they scroll into view inside the panel. Two triggers (observer + scroll check), so a chapter
  // that is on screen can never stay hidden.
  useEffect(() => {
    const el = root.current; if (!el) return undefined
    const panel = el.closest('.ts-panel'); const items = [...el.querySelectorAll('.st-ch')]; items.forEach((c) => c.classList.remove('in'))
    const check = () => { const view = (panel ?? document.documentElement).getBoundingClientRect(); for (const c of items) { if (c.classList.contains('in')) continue; const r = c.getBoundingClientRect(); if (r.top < view.bottom - 24 && r.bottom > view.top) c.classList.add('in') } }
    let io = null
    if ('IntersectionObserver' in window) { io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in') }), { root: panel, threshold: 0 }); items.forEach((c) => io.observe(c)) }
    panel?.addEventListener('scroll', check, { passive: true }); const t = setTimeout(check, 60)
    return () => { io?.disconnect(); panel?.removeEventListener('scroll', check); clearTimeout(t) }
  }, [story])
  const jump = (i) => { if (i != null && i >= 0) { setPlaying(false); setFrame(i) } }
  const copy = () => { try { navigator.clipboard?.writeText(story.process) } catch { /* clipboard not available: the text can still be selected */ } }
  return (
    <div className="st" ref={root}>
      <header className="st-head"><span className={`st-kind ${story.kind}`}>{story.label} · {story.place}</span><h3>{story.title}</h3><p>{story.subtitle}</p></header>
      {story.facts && <ul className="st-facts" aria-label="Key facts">{story.facts.map(([v, l, r]) => { const src = story.sources[r - 1]; return (
        <li key={l}><b>{v}</b><span>{l}{src && <a className="st-ref" href={src[1]} target="_blank" rel="noopener noreferrer" title={src[0]}>{r}</a>}</span></li>) })}</ul>}
      {ts
        ? <SeasonPlayer ts={ts} frame={frame} setFrame={setFrame} playing={playing} setPlaying={setPlaying} hasImages={hasImages} />
        : <div className="st-nodata" role="note"><b>No radar data has been processed for this place yet.</b> The story below is background from the listed sources. There are no radar results from us on this page.</div>}
      {story.chapters.map((c, k) => (
        <section key={c.id} className="st-ch" style={{ '--i': k }}>
          <h4><span className="st-num">{k + 1}</span>{c.heading}</h4>
          {FIGS[c.figure] && <PulseFigure kind={c.figure} />}
          {hasViz(c.figure) && <StoryViz kind={c.figure} viz={c.viz} sources={story.sources} />}
          {c.figure === 'findings' && found && <OurData ts={ts} frame={frame} onPick={jump} />}
          {c.figure === 'findings' && found && <>
            {found.sentences.map((t, i) => <p key={i}>{t}</p>)}
            <div className="st-jump">
              <button onClick={() => jump(found.darkestIndex)}>Show the darkest date</button>
              <button onClick={() => jump(found.brightestIndex)}>Show the brightest date</button>
            </div>
          </>}
          {c.figure === 'findings' && !found && <div className="st-todo">
            <p><b>Nothing yet.</b> We have not processed radar scenes for this place, so we have no result to report.{story.process ? ' This command will process it; the charts and this section then fill in by themselves:' : ''}</p>
            {story.process && <><code>{story.process}</code><button onClick={copy}>Copy command</button></>}
            {story.processNote && <p className="ts-note">{withRefs(story.processNote, story.sources)}</p>}
          </div>}
          {c.text.map((t, i) => <p key={i}>{withRefs(t, story.sources)}</p>)}
        </section>
      ))}
      <section className="st-ch st-src" style={{ '--i': story.chapters.length }}>
        <h4>Sources</h4>
        <ol>{story.sources.map(([label, url]) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{label}</a></li>)}</ol>
        <p className="ts-note">Background facts come from these sources. {ts ? 'Every number about this site comes from the processed radar file shown in the charts.' : 'This page reports no radar measurements of our own.'}</p>
      </section>
    </div>
  )
}
