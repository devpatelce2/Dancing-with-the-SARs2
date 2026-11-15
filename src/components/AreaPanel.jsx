import React, { useEffect, useRef, useState } from 'react'

const SIZES = [['Local, about 22 km', 0.1], ['City region, about 55 km', 0.25], ['District, about 110 km', 0.5], ['Wide, about 550 km', 2.5]]
const EVENTS = [['all', 'All events'], ['floods', 'Floods'], ['earthquakes', 'Earthquakes (M4.5+)'], ['wildfires', 'Wildfires'], ['cyclones', 'Severe storms / cyclones'], ['volcanoes', 'Volcanic activity'], ['landslides', 'Landslides'], ['droughts', 'Droughts']]
const LABEL = Object.fromEntries(EVENTS)
// NISAR launched in July 2025, so earlier events need Sentinel-1. Auto asks the catalogue and uses NISAR only when it has scenes.
const MISSIONS = [['auto', 'Auto (NISAR if available)'], ['nisar', 'NISAR (L-band, 2025 on)'], ['sentinel1', 'Sentinel-1 (C-band, 2014 on)']]

// Documented incidents to try. Dates bracket the event with NISAR's ~12-day repeat: a pre-flood scene, scenes at/after the peak.
const PRESETS = [
  { label: 'Sylhet-Sunamganj flood, Jul 2026', place: 'Sunamganj, Bangladesh', size: 0.1, event: 'floods', from: '2026-06-17', to: '2026-07-31', eventDate: '2026-07-11',
    note: 'Surma and Kushiyara rivers were above danger level from about 10 to 27 July 2026 (peak around 11-14 July).' },
]

// Place name -> lat/long. The backend does the lookup (Nominatim, then Open-Meteo); if it is not running, or it finds nothing,
// the browser tries Nominatim directly with simpler versions of the name (drops "Peninsula", "Region", etc. and the country).
const NOT_FOUND = 'Place not found. Try a nearby town or add the country.'
async function geocode(q, half) {
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&half=${half}`)
    if (r.ok) return await r.json()
  } catch { /* backend not reachable: use the browser lookup below */ }
  const name = q.split(',')[0].trim()
  const bare = name.replace(/\b(peninsula|region|area|district|province|prefecture|gulf|bay|island|islands|city)\b/gi, '').replace(/\s+/g, ' ').trim()
  const tries = [...new Set([q, bare && bare !== name ? `${bare}, ${q.split(',').slice(1).join(',').trim()}`.replace(/,\s*$/, '') : '', name, bare].filter(Boolean))]
  for (const t of tries) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(t)}&format=json&limit=1&accept-language=en`)
      const hits = r.ok ? await r.json() : []
      if (hits.length) {
        const lat = +hits[0].lat, lon = +hits[0].lon
        return { name: hits[0].display_name, lat, lon, bbox: [lon - half, lat - half, lon + half, lat + half] }
      }
    } catch { /* try the next variant */ }
  }
  throw new Error(NOT_FOUND)
}

export default function AreaPanel({ onApply, onClear, heatStats }) {
  const [q, setQ] = useState(''); const [size, setSize] = useState(0.1); const [event, setEvent] = useState('all')
  const [area, setArea] = useState(null); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false)
  const [sarFrom, setSarFrom] = useState('2026-06-17'); const [sarTo, setSarTo] = useState(''); const [eventDate, setEventDate] = useState(''); const [job, setJob] = useState(null); const [mission, setMission] = useState('auto'); const poll = useRef(null)

  useEffect(() => () => clearInterval(poll.current), [])

  const apply = async () => {
    setBusy(true); setMsg(null)
    try {
      let a = null
      if (q.trim()) { const g = await geocode(q.trim(), size); a = { name: g.name, lat: g.lat, lon: g.lon, bbox: g.bbox, place: q.trim() }; setArea(a) } else setArea(null)
      onApply({ bounds: a?.bbox ?? null, event })
      setMsg({ ok: true, text: a ? `Showing ${LABEL[event].toLowerCase()} near ${a.name.split(',').slice(0, 2).join(',')} (${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}).` : `Showing ${LABEL[event].toLowerCase()} worldwide.` })
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  const usePreset = (p) => { setQ(p.place); setSize(p.size); setEvent(p.event); setSarFrom(p.from); setSarTo(p.to); setEventDate(p.eventDate); setMsg({ ok: true, text: `${p.note} Press Apply filter, then Analyze.` }) }
  const clear = () => { setArea(null); setQ(''); setMsg(null); onClear() }

  const analyze = async () => {
    setMsg(null)
    try {
      const start = sarFrom
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place: area.place, halfDeg: Math.min(0.3, size), event: event === 'all' ? 'SAR surface change' : LABEL[event], mission, start, end: sarTo || undefined, eventDate: eventDate || undefined, maxScenes: sarTo ? 6 : undefined, thresholdDb: -3 }) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.detail || `Backend returned HTTP ${r.status}`)
      setJob({ id: body.jobId, siteId: body.siteId, status: 'running', progress: 'Starting', log: [] })
      clearInterval(poll.current)
      poll.current = setInterval(async () => {
        try {
          const j = await (await fetch(`/api/jobs/${body.jobId}`)).json()
          setJob((p) => ({ ...p, ...j }))
          if (j.status !== 'running') { clearInterval(poll.current); if (j.status === 'done') window.dispatchEvent(new CustomEvent('sar-sites-updated', { detail: { siteId: body.siteId } })) }
        } catch { /* keep polling */ }
      }, 2500)
    } catch (e) {
      setMsg({ ok: false, text: /fetch|NetworkError|Failed/i.test(e.message) ? 'Backend is not running. In a second terminal: uvicorn backend.app.main:app --port 8000 (with EARTHDATA_TOKEN set).' : e.message })
    }
  }
  const canAnalyze = !!area && size <= 0.25 && job?.status !== 'running'
  const s = heatStats

  return (
    <section className="area-panel">
      <h2>Area and event filter</h2>
      <input className="area-q" type="text" placeholder="Search a place, e.g. Sylhet, Bangladesh" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} aria-label="Place name" />
      <div className="area-row">
        <label>Area size<select value={size} onChange={(e) => setSize(+e.target.value)}>{SIZES.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Event<select value={event} onChange={(e) => setEvent(e.target.value)}>{EVENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <div className="area-row">
        <button className="primary" onClick={apply} disabled={busy}>{busy ? 'Finding...' : 'Apply filter'}</button>
        <button onClick={clear}>Clear</button>
      </div>
      {msg && <p className={`note ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
      {s && (s.count > 0 || msg?.ok) && (
        <p className="area-stat" role="status">{s.count > 0
          ? <><b>{s.count}</b> event{s.count === 1 ? '' : 's'} in {s.hasArea ? 'the selected area' : 'the world'} for the current time window: {Object.entries(s.byLayer).map(([k, v]) => `${LABEL[k] ?? k} ${v}`).join(', ')}. Thermal colours show where they cluster (blue few, red many).</>
          : <>No matching events in {s.hasArea ? 'this area' : 'the world'} for the current time window. Try a larger area or a longer &quot;Show data from last&quot; setting.</>}</p>
      )}
      <div className="area-row presets">{PRESETS.map((p) => <button key={p.label} onClick={() => usePreset(p)} title={p.note}>Try: {p.label}</button>)}</div>
      <div className="area-row">
        <label className="area-from">SAR scenes from<input type="date" value={sarFrom} onChange={(e) => setSarFrom(e.target.value)} /></label>
        <label className="area-from">to (optional)<input type="date" value={sarTo} onChange={(e) => setSarTo(e.target.value)} /></label>
      </div>
      <label className="area-from">Event date (optional, marks the chart)<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
      <label className="area-from">Satellite<select value={mission} onChange={(e) => setMission(e.target.value)} aria-label="Satellite for SAR analysis">{MISSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <button onClick={analyze} disabled={!canAnalyze} title={!area ? 'Apply a place first' : size > 0.25 ? 'Choose Local or City region for SAR analysis' : ''}>Analyze surface change here</button>
      {area && size > 0.25 && <p className="note">SAR analysis needs a small area. Choose Local or City region.</p>}
      {job && <p className={`note ${job.status === 'error' ? 'err' : job.status === 'done' ? 'ok' : ''}`}>
        {job.status === 'running' && `Analyzing ${job.siteId}: ${job.progress || job.log?.slice(-1)[0] || 'starting'} (${job.elapsedS ?? 0}s)`}
        {job.status === 'done' && `Done. ${job.siteId} is now in the Surface change panel.`}
        {job.status === 'error' && `Failed: ${job.error || (job.log || []).slice(-1)[0] || 'see the backend terminal'}`}
      </p>}
      {job?.status === 'error' && job.log?.length > 0 && <details className="joblog"><summary>Show full log</summary><pre>{job.log.join('\n')}</pre></details>}
    </section>
  )
}
