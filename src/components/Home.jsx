import React, { useEffect, useRef, useState } from 'react'
import { StellarisMark } from '../ui/TeamLogo.jsx'
import { CASE_STUDIES } from '../content/stories.js'

// Landing page. Everything here is either navigation, a description of what the app does, or a fact already
// shown (with its source) inside the matching story. Whether a case study has processed radar data is read
// from /data/sites.json, never assumed.
const OBJECTIVES = [
  ['01', 'See where radar looked', 'Every NISAR and Sentinel-1 scene in the ASF catalogue, drawn as a footprint on a flat map or a 3D globe and filtered by a timeline.'],
  ['02', 'Understand what changed', 'Radar brightness compared date by date: change maps, a dotted time series, statistics and a side-by-side date slider.'],
  ['03', 'Follow the story', 'Four case studies, each told chapter by chapter with animated diagrams, published numbers and our own measurements.'],
]
const STEPS = [
  ['Find', 'The ASF Search API lists the radar scenes over a place.'],
  ['Stream', 'Only the needed blocks of each 7 GB NISAR file are read over the network.'],
  ['Clean', 'Speckle is averaged out and invalid pixels are masked.'],
  ['Compare', 'Each date is compared with a reference built from earlier scenes.'],
  ['Measure', 'Mean brightness, changed area, z-score and trend for every date.'],
  ['Show', 'Layers, charts and stories on the map, with sources.'],
]
const SOURCES = [['NISAR', 'NASA and ISRO · L-band radar'], ['Sentinel-1', 'ESA Copernicus · C-band radar'], ['ASF DAAC', 'scene catalogue and data'], ['USGS', 'earthquake catalogue'], ['NASA EONET', 'natural-event feed'], ['Natural Earth', 'borders and labels']]

export default function Home({ onEnter }) {
  const root = useRef(null); const [sites, setSites] = useState(null)
  useEffect(() => { let live = true; fetch('/data/sites.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setSites(new Set((j?.sites ?? []).map((s) => s.id))) }).catch(() => { if (live) setSites(new Set()) }); return () => { live = false } }, [])
  useEffect(() => { // sections rise in as they are scrolled to
    const el = root.current; if (!el) return undefined; const items = [...el.querySelectorAll('.hm-rv')]
    if (!('IntersectionObserver' in window)) { items.forEach((i) => i.classList.add('in')); return undefined }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in') }), { root: el, threshold: 0.08 }); items.forEach((i) => io.observe(i))
    const t = setTimeout(() => items.forEach((i) => { const r = i.getBoundingClientRect(); if (r.top < window.innerHeight) i.classList.add('in') }), 200)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [])
  const go = (id) => root.current?.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="hm" ref={root}>
      <nav className="hm-nav" aria-label="Home page">
        <a className="hm-brand" href="#/" onClick={(e) => { e.preventDefault(); root.current?.scrollTo({ top: 0, behavior: 'smooth' }) }}><StellarisMark size={34} /><span><b>Dancing with the SARs</b><i>Team Stellaris</i></span></a>
        <div className="hm-links"><button onClick={() => go('#hm-cases')}>Case studies</button><button onClick={() => go('#hm-how')}>How it works</button><button onClick={() => go('#hm-data')}>Data</button></div>
        <button className="hm-cta small" onClick={() => onEnter()}>Open the map</button>
      </nav>

      <header className="hm-hero-wrap">
       <div className="hm-hero">
        <div className="hm-hero-text">
          <p className="hm-eyebrow">NASA Space Apps Challenge 2026</p>
          <h1>Watch the Earth change, <em>through radar eyes.</em></h1>
          <p className="hm-lede">Radar satellites see through cloud, smoke and night. This map shows where they looked, what changed on the ground between passes, and the story behind it.</p>
          <div className="hm-actions"><button className="hm-cta" onClick={() => onEnter()}>Open the map <span aria-hidden="true">→</span></button><button className="hm-ghost" onClick={() => go('#hm-cases')}>See the case studies</button></div>
          <ul className="hm-strip" aria-label="At a glance"><li><b>4</b><span>case studies</span></li><li><b>2</b><span>radar missions</span></li><li><b>12 days</b><span>NISAR repeat</span></li><li><b>2D + 3D</b><span>map and globe</span></li></ul>
        </div>
       </div>
      </header>

      <section className="hm-sec hm-rv" aria-labelledby="hm-obj-h">
        <h2 id="hm-obj-h">What this project does</h2>
        <div className="hm-obj">{OBJECTIVES.map(([n, h, t]) => <article key={n}><span>{n}</span><h3>{h}</h3><p>{t}</p></article>)}</div>
      </section>

      <section className="hm-sec hm-rv" id="hm-cases" aria-labelledby="hm-cases-h">
        <h2 id="hm-cases-h">Four kinds of change, four stories</h2>
        <p className="hm-sub">Each story opens on the map, with animated diagrams, published numbers that link to their sources, and our own radar measurements where we have processed the data.</p>
        <div className="hm-cases">{CASE_STUDIES.map((c) => { const has = sites ? c.siteIds.some((id) => sites.has(id)) : null; return (
          <article key={c.key} className={`hm-case ${c.key}`}>
            <div className="hm-case-top"><span className="hm-kind">{c.story.label}</span>{has != null && <span className={`hm-status ${has ? 'ok' : ''}`}>{has ? 'Radar data processed' : 'Story only, data not processed yet'}</span>}</div>
            <h3>{c.story.title}</h3><p className="hm-place">{c.story.place}</p><p className="hm-desc">{c.story.subtitle}</p>
            <ul>{c.story.facts.map(([v, l]) => <li key={l}><b>{v}</b><span>{l}</span></li>)}</ul>
            <button onClick={() => onEnter(c.key)}>Open this story <span aria-hidden="true">→</span></button>
          </article>) })}</div>
      </section>

      <section className="hm-sec hm-rv" id="hm-how" aria-labelledby="hm-how-h">
        <h2 id="hm-how-h">From a radar file to a change map</h2>
        <ol className="hm-steps">{STEPS.map(([h, t], i) => <li key={h}><span>{i + 1}</span><h3>{h}</h3><p>{t}</p></li>)}</ol>
      </section>

      <section className="hm-sec hm-rv hm-honest" aria-labelledby="hm-hon-h">
        <div><h2 id="hm-hon-h">Candidates, not claims</h2><p>Changed pixels are shown as candidates. They have not been checked against an independent map yet, so this site does not report an accuracy score or claim to detect disasters by itself. Any demo data is labelled as synthetic.</p></div>
        <ul><li><b>Real data</b><span>NISAR and Sentinel-1 scenes, processed by us</span></li><li><b>Sourced facts</b><span>every background number links to where it came from</span></li><li><b>Open method</b><span>thresholds, baselines and limits are shown beside each result</span></li></ul>
      </section>

      <section className="hm-sec hm-rv" id="hm-data" aria-labelledby="hm-data-h">
        <h2 id="hm-data-h">Data and services</h2>
        <ul className="hm-src">{SOURCES.map(([n, d]) => <li key={n}><b>{n}</b><span>{d}</span></li>)}</ul>
        <p className="hm-sub">Sentinel-1 is a mission of ESA and the European Commission. NISAR is a joint mission of NASA and ISRO. This project is not affiliated with either.</p>
      </section>

      <footer className="hm-foot">
        <StellarisMark size={44} />
        <div><b>Team Stellaris</b><span>Dancing with the SARs · NASA Space Apps Challenge 2026</span></div>
        <button className="hm-cta" onClick={() => onEnter()}>Open the map <span aria-hidden="true">→</span></button>
      </footer>
    </div>
  )
}
