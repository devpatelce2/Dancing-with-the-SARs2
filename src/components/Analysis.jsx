import { useEffect, useMemo, useState } from 'react'
import { BarChart3, MapPin, Crosshair, Clock, Play, X, Search, FlaskConical } from 'lucide-react'
import { provider, DEMO_MODE } from '../lib/dataProvider.js'
import { NO_DATA_MESSAGE } from '../lib/dataMode.js'
import {
  fetchHourly, valueAt, METRIC_INFO, geocodeSearch,
} from '../lib/weather.js'
import { LineChart, DeltaBars } from './Charts.jsx'

const DAY = 86400000
const HOUR = 3600000
export const COLOR_A = '#4cc9f0'
export const COLOR_B = '#ffc775'

const MODES = [
  { id: 'time', label: 'Time × Time', hint: 'Same area, two different moments.' },
  { id: 'area', label: 'Area × Area', hint: 'Two areas at the same moment.' },
  { id: 'both', label: 'Area × Time', hint: 'Any area at any moment vs another area at another moment.' },
]

const inputUtc = (ms) => new Date(ms).toISOString().slice(0, 16)
const fmtUtc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
const shortName = (p) => (p?.name ? p.name.split(',')[0] : 'Area')
const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))
const WX_KEYS = Object.keys(METRIC_INFO)

// A is always free; B depends on the comparison mode.
export function effective(an) {
  return {
    A: an.A,
    B: {
      place: an.mode === 'time' ? an.A.place : an.B.place,
      ms: an.mode === 'area' ? an.A.ms : an.B.ms,
    },
  }
}

/* ------------------------------------------------------------------ */

function SlotEditor({ slot, color, value, lockPlace, lockTime, an, setAn, clockMs, clickedPlace, onPickSlot, onSetSlotPlace }) {
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const setMs = (ms) => setAn((a) => ({ ...a, [slot]: { ...a[slot], ms } }))

  async function search(e) {
    e.preventDefault()
    setErr('')
    if (!q.trim()) return
    try {
      const hit = await geocodeSearch(q.trim())
      if (!hit) { setErr('Not found'); return }
      onSetSlotPlace(slot, hit.lat, hit.lon, hit.name)
      setQ('')
    } catch { setErr('Search failed') }
  }

  return (
    <div className="slot" style={{ '--slot': color }}>
      <div className="slot-head">
        <span className="slot-chip">{slot}</span>
        <div className="slot-place">
          {value.place
            ? <><strong>{value.place.name}</strong><small>{value.place.lat.toFixed(3)}, {value.place.lon.toFixed(3)}</small></>
            : <em>No area selected</em>}
        </div>
      </div>

      {lockPlace ? (
        <div className="slot-lock">Area = same as A</div>
      ) : (
        <>
          <div className="slot-actions">
            <button className={an.pickSlot === slot ? 'on' : ''} onClick={() => onPickSlot(an.pickSlot === slot ? null : slot)}>
              <Crosshair size={13} /> {an.pickSlot === slot ? 'Click the map…' : 'Pick on map'}
            </button>
            <button disabled={!clickedPlace}
              onClick={() => onSetSlotPlace(slot, clickedPlace.lat, clickedPlace.lon, clickedPlace.name)}>
              <MapPin size={13} /> Use clicked
            </button>
          </div>
          <form className="slot-search" onSubmit={search}>
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="or search a place…" />
          </form>
          {err && <div className="error-text">{err}</div>}
        </>
      )}

      {lockTime ? (
        <div className="slot-lock">Time = same as A</div>
      ) : (
        <div className="slot-time">
          <input type="datetime-local" step="60" value={inputUtc(value.ms)}
            aria-label={`Time ${slot} (UTC)`}
            onChange={(e) => {
              const ms = Date.parse(`${e.target.value}:00Z`)
              if (!Number.isNaN(ms)) setMs(ms)
            }} />
          <button title="Use the timeline's current time" onClick={() => setMs(clockMs)}><Clock size={13} /> Timeline</button>
          <button onClick={() => setMs(Date.now())}>Now</button>
        </div>
      )}
      <div className="slot-utc">UTC</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CompareTab({ A, B, clockMs }) {
  const key = `${A.place?.lat},${A.place?.lon},${A.ms}|${B.place?.lat},${B.place?.lon},${B.ms}`
  const [wx, setWx] = useState({ key: '', A: null, B: null })

  useEffect(() => {
    let cancel = false
    const one = async (s) => {
      if (!s.place) return null
      const r = await fetchHourly(s.place.lat, s.place.lon, s.ms - DAY, s.ms + DAY)
      return r.error ? { error: r.error } : { data: r.data }
    }
    Promise.all([one(A), one(B)]).then(([a, b]) => { if (!cancel) setWx({ key, A: a, B: b }) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const loading = wx.key !== key
  const surfA = useMemo(() => (A.place ? provider.surfaceAt(A.place, A.ms) : null), [A.place, A.ms])
  const surfB = useMemo(() => (B.place ? provider.surfaceAt(B.place, B.ms) : null), [B.place, B.ms])

  if (!A.place || !B.place) {
    return <p className="muted">Choose an area for {A.place ? 'B' : 'A'} (click “Pick on map”, then click the globe) to see the comparison.</p>
  }

  const wxRow = (k) => {
    const info = METRIC_INFO[k]
    const a = loading ? null : valueAt(wx.A?.data, k, A.ms)
    const b = loading ? null : valueAt(wx.B?.data, k, B.ms)
    return { label: info.label, unit: info.unit, d: info.digits, a, b }
  }
  const surfRows = provider.metrics.map((m) => ({
    label: m.label, unit: m.unit, d: m.digits, a: surfA[m.id], b: surfB[m.id], trial: true,
  }))

  const Table = ({ rows, title, trial }) => (
    <>
      <div className="group-label table-title">{title}{trial && <span className="trial-tag">TRIAL</span>}</div>
      <table className="cmp">
        <thead><tr><th /><th style={{ color: COLOR_A }}>A</th><th style={{ color: COLOR_B }}>B</th><th>B − A</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const d = r.a != null && r.b != null ? r.b - r.a : null
            return (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{fmt(r.a, r.d)}<small>{r.unit}</small></td>
                <td>{fmt(r.b, r.d)}<small>{r.unit}</small></td>
                <td className={d == null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>
                  {d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(r.d)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )

  const errMsg = !loading && (wx.A?.error || wx.B?.error)
  return (
    <>
      <div className="cmp-cap">
        <div style={{ borderColor: COLOR_A }}><b style={{ color: COLOR_A }}>A</b> {shortName(A.place)}<small>{fmtUtc(A.ms)}</small></div>
        <div style={{ borderColor: COLOR_B }}><b style={{ color: COLOR_B }}>B</b> {shortName(B.place)}<small>{fmtUtc(B.ms)}</small></div>
      </div>
      {loading && <p className="muted small">Loading weather for both moments…</p>}
      {errMsg && <p className="error-text">{errMsg}</p>}
      <Table title="WEATHER (REAL DATA · OPEN-METEO)" rows={WX_KEYS.map(wxRow)} />
      {!loading && wx.A?.data && (
        <p className="muted small">
          A: {wx.A.data.label}{wx.B?.data ? ` · B: ${wx.B.data.label}` : ''}. Values are interpolated to the exact minute from hourly model data.
        </p>
      )}
      <Table title="SURFACE INDICATORS" rows={surfRows} trial />
      <p className="muted small">Timeline is at {fmtUtc(clockMs)}.</p>
    </>
  )
}

/* ------------------------------------------------------------------ */

function SurfaceTab({ A, B, an, setAn, onJump, onAnimate }) {
  const [rad, setRad] = [an.radiusKm, (r) => setAn((a) => ({ ...a, radiusKm: r }))]
  if (!A.place) return <p className="muted">Choose area A first — surface change is calculated for the area around it, between A’s time and B’s time.</p>

  const tr = provider.transitions(A.place, A.ms, B.ms, rad)
  const total = tr.before.total
  const classRows = provider.classes.map((c) => ({
    ...c, a: tr.before[c.id], b: tr.after[c.id], d: tr.after[c.id] - tr.before[c.id],
  }))
  const label = (id) => provider.classes.find((c) => c.id === id)?.label
  const surfA = provider.surfaceAt(A.place, A.ms)
  const surfB = provider.surfaceAt(A.place, B.ms)

  return (
    <>
      <div className="cmp-cap">
        <div style={{ borderColor: COLOR_A }}><b style={{ color: COLOR_A }}>From</b> {fmtUtc(A.ms)}<small>{shortName(A.place)}</small></div>
        <div style={{ borderColor: COLOR_B }}><b style={{ color: COLOR_B }}>To</b> {fmtUtc(B.ms)}<small>{(A.ms === B.ms) ? 'same moment' : `${Math.round(Math.abs(B.ms - A.ms) / DAY)} days apart`}</small></div>
      </div>

      <div className="row-inline">
        <label>Analysis radius
          <select value={rad} onChange={(e) => setRad(Number(e.target.value))}>
            {[5, 10, 25].map((r) => <option key={r} value={r}>{r} km (≈{Math.round(Math.PI * r * r)} km²)</option>)}
          </select>
        </label>
        <label className="chk"><input type="checkbox" checked={an.highlight}
          onChange={(e) => setAn((a) => ({ ...a, highlight: e.target.checked }))} /> Highlight on map</label>
      </div>

      <div className="slot-actions wide">
        <button onClick={() => onJump(A.ms)}>Timeline → From</button>
        <button onClick={() => onJump(B.ms)}>Timeline → To</button>
        <button className="on" onClick={() => onAnimate(A.ms, B.ms)}><Play size={13} /> Animate</button>
      </div>
      <p className="muted small">
        Coloured zones on the map show where the surface differs from “From”, at whatever moment the timeline is on. Scrub the timeline or press Animate.
      </p>
      <div className="legend">
        {Object.values(provider.patchTypes).map((t) => (<span key={t.label}><i style={{ background: t.color }} />{t.label}</span>))}
      </div>

      <div className="group-label table-title">WHAT REPLACED WHAT<span className="trial-tag">TRIAL</span></div>
      {tr.rows.length === 0 && <p className="muted small">No meaningful change between these two moments.</p>}
      {tr.rows.slice(0, 5).map((r) => (
        <div className="detail-row" key={`${r.from}-${r.to}`}>
          <span>{label(r.from)} → {label(r.to)}</span>
          <strong>{r.km2.toFixed(2)} km² <small>({((r.km2 / total) * 100).toFixed(1)}%)</small></strong>
        </div>
      ))}

      <div className="group-label table-title">LAND COVER CHANGE</div>
      <DeltaBars rows={classRows.map((c) => ({ label: c.label, value: c.d, color: c.color }))} />
      <table className="cmp">
        <thead><tr><th /><th style={{ color: COLOR_A }}>From</th><th style={{ color: COLOR_B }}>To</th><th>Δ km²</th></tr></thead>
        <tbody>
          {classRows.map((c) => (
            <tr key={c.id}><td><i className="dot" style={{ background: c.color }} />{c.label}</td>
              <td>{c.a.toFixed(1)}</td><td>{c.b.toFixed(1)}</td>
              <td className={c.d > 0 ? 'up' : c.d < 0 ? 'down' : ''}>{c.d > 0 ? '+' : ''}{c.d.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="group-label table-title">INDICATORS</div>
      <table className="cmp">
        <thead><tr><th /><th style={{ color: COLOR_A }}>From</th><th style={{ color: COLOR_B }}>To</th><th>Δ</th></tr></thead>
        <tbody>
          {provider.metrics.map((m) => {
            const a = surfA[m.id], b = surfB[m.id], d = b - a
            return (
              <tr key={m.id}><td>{m.label}</td><td>{fmt(a, m.digits)}<small>{m.unit}</small></td>
                <td>{fmt(b, m.digits)}<small>{m.unit}</small></td>
                <td className={d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d > 0 ? '+' : ''}{d.toFixed(m.digits)}</td></tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

/* ------------------------------------------------------------------ */

function GraphTab({ A, B, an, setAn }) {
  const metric = an.metric
  const view = an.view
  const isWx = WX_KEYS.includes(metric)
  const isLand = metric === 'landcover'
  const effView = isLand ? 'span' : view
  const winOptions = isWx ? [1, 3, 7] : [30, 90, 365, 1095]
  const win = winOptions.includes(an.win) ? an.win : winOptions[1] ?? winOptions[0]

  const key = [metric, effView, win, an.radiusKm, A.place?.lat, A.place?.lon, A.ms, B.place?.lat, B.place?.lon, B.ms].join('|')
  const [out, setOut] = useState({ key: '', series: [], error: '' })

  useEffect(() => {
    let cancel = false
    async function build() {
      const slots = [['A', A, COLOR_A], ['B', B, COLOR_B]].filter(([, s]) => s.place)
      if (!slots.length) return { series: [], error: '' }
      const from = Math.min(A.ms, B.ms), to = Math.max(A.ms, B.ms)
      const series = []
      let error = ''
      const sameAB = A.place && B.place && A.place.lat === B.place.lat && A.place.lon === B.place.lon

      if (isLand) {
        if (!A.place) return { series: [], error: '' }
        const area = Math.PI * an.radiusKm * an.radiusKm
        provider.classes.forEach((c) => {
          series.push({
            name: c.label, color: c.color,
            points: provider.series(A.place, c.id, from, to, 60).map(([x, y]) => [x, (y / 100) * area]),
          })
        })
        return { series, error: '' }
      }

      if (isWx) {
        if (effView === 'span' && to - from > 30 * DAY) {
          return { series: [], error: 'Weather “span” view is limited to 30 days. Use “Overlay” or choose closer times.' }
        }
        for (const [name, s, color] of slots) {
          if (effView === 'span' && name === 'B' && sameAB) continue
          const lo = effView === 'span' ? from : s.ms - win * DAY
          const hi = effView === 'span' ? to : s.ms + win * DAY
          const r = await fetchHourly(s.place.lat, s.place.lon, lo, hi)
          if (r.error) { error = r.error; continue }
          const { ts, vars } = r.data
          const arr = vars[metric] ?? []
          const stride = Math.max(1, Math.ceil(ts.length / 260))
          const pts = []
          ts.forEach((t, i) => {
            if (t < lo || t > hi || i % stride) return
            pts.push([effView === 'span' ? t : (t - s.ms) / HOUR, arr[i]])
          })
          series.push({
            name: effView === 'span' && sameAB ? shortName(s.place) : `${name} · ${shortName(s.place)}${effView === 'overlay' ? ` · ${fmtUtc(s.ms).slice(0, 10)}` : ''}`,
            color, points: pts, dash: name === 'B',
          })
        }
        return { series, error: series.length ? error : error || 'No data for this period.' }
      }

      // trial surface metrics
      for (const [name, s, color] of slots) {
        if (effView === 'span' && name === 'B' && sameAB) continue
        const pts = effView === 'span'
          ? provider.series(s.place, metric, from, to, 80)
          : provider.series(s.place, metric, s.ms - win * DAY, s.ms + win * DAY, 80).map(([x, y]) => [(x - s.ms) / DAY, y])
        series.push({
          name: effView === 'span' && sameAB ? shortName(s.place) : `${name} · ${shortName(s.place)}${effView === 'overlay' ? ` · ${fmtUtc(s.ms).slice(0, 10)}` : ''}`,
          color, points: pts, dash: name === 'B',
        })
      }
      return { series, error: '' }
    }
    build().then((r) => { if (!cancel) setOut({ key, ...r }) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const loading = out.key !== key
  const info = isLand
    ? { label: 'Land cover', unit: 'km²', digits: 1 }
    : isWx ? METRIC_INFO[metric] : provider.metrics.find((m) => m.id === metric)
  const xFormat = effView === 'span'
    ? (x) => new Date(x).toISOString().slice(2, 10)
    : (x) => `${x > 0 ? '+' : ''}${Math.round(x)}${isWx ? 'h' : 'd'}`

  if (!A.place) return <p className="muted">Choose area A first to draw graphs.</p>

  return (
    <>
      <div className="row-inline col">
        <label>Metric
          <select value={metric} onChange={(e) => setAn((a) => ({ ...a, metric: e.target.value }))}>
            <optgroup label="Weather (real data)">
              {WX_KEYS.map((k) => <option key={k} value={k}>{METRIC_INFO[k].label} ({METRIC_INFO[k].unit})</option>)}
            </optgroup>
            <optgroup label="Surface (TRIAL data)">
              {provider.metrics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              <option value="landcover">Land cover — all classes (span)</option>
            </optgroup>
          </select>
        </label>
        {!isLand && (
          <div className="seg">
            <button className={effView === 'overlay' ? 'active' : ''} onClick={() => setAn((a) => ({ ...a, view: 'overlay' }))}>Overlay A / B</button>
            <button className={effView === 'span' ? 'active' : ''} onClick={() => setAn((a) => ({ ...a, view: 'span' }))}>Span A → B</button>
          </div>
        )}
        {effView === 'overlay' && (
          <label>Window around each moment
            <select value={win} onChange={(e) => setAn((a) => ({ ...a, win: Number(e.target.value) }))}>
              {winOptions.map((w) => <option key={w} value={w}>± {w >= 365 ? `${w / 365} year${w > 365 ? 's' : ''}` : `${w} day${w > 1 ? 's' : ''}`}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="group-label table-title">
        {info.label.toUpperCase()}{!isWx && <span className="trial-tag">TRIAL</span>}
      </div>
      {loading && <p className="muted small">Loading…</p>}
      {!loading && out.error && <p className="error-text">{out.error}</p>}
      {!loading && out.series.length > 0 && (
        <LineChart series={out.series} xFormat={xFormat} yUnit={info.unit} digits={info.digits}
          xTitle={effView === 'overlay' ? 'time relative to each selected moment' : 'date (UTC)'} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function NoProcessedData({ onClose }) {
  return (
    <aside className="analysis glass">
      <div className="an-head">
        <div className="an-title"><BarChart3 size={16} /> ANALYSIS</div>
        <button className="close-x" onClick={onClose} aria-label="Close analysis"><X size={16} /></button>
      </div>
      <p className="trial-note"><b>{NO_DATA_MESSAGE}.</b> Flood statistics are shown only when they come from a processed
        NISAR product pair (public/data/&lt;site_id&gt;/meta.json). None has been loaded yet, and no synthetic values are
        shown as observations. The live ASF catalogue search in the sidebar still works (metadata only).</p>
    </aside>
  )
}

export default function Analysis(props) {
  if (!DEMO_MODE) return <NoProcessedData onClose={props.onClose} />
  const { an, setAn, onClose, onPickSlot } = props
  const { A, B } = effective(an)
  const mode = MODES.find((m) => m.id === an.mode)

  return (
    <aside className="analysis glass">
      <div className="an-head">
        <div className="an-title"><BarChart3 size={16} /> ANALYSIS</div>
        <span className="trial-banner"><FlaskConical size={12} /> DEMO MODE · SYNTHETIC DATA</span>
        <button className="close-x" onClick={onClose} aria-label="Close analysis"><X size={16} /></button>
      </div>
      <p className="trial-note">
        Weather is real (Open-Meteo). Surface-change values are <b>synthetic placeholders</b> until the real
        SAR dataset is connected.
      </p>

      <div className="seg three">
        {MODES.map((m) => (
          <button key={m.id} className={an.mode === m.id ? 'active' : ''}
            onClick={() => setAn((a) => ({ ...a, mode: m.id }))}>{m.label}</button>
        ))}
      </div>
      <p className="muted small mode-hint">{mode.hint}</p>

      <SlotEditor slot="A" color={COLOR_A} value={A} {...props} lockPlace={false} lockTime={false} onPickSlot={onPickSlot} />
      <SlotEditor slot="B" color={COLOR_B} value={B} {...props} lockPlace={an.mode === 'time'} lockTime={an.mode === 'area'} onPickSlot={onPickSlot} />

      <div className="tabs">
        {[['compare', 'Compare'], ['surface', 'Surface change'], ['graph', 'Graphs']].map(([id, label]) => (
          <button key={id} className={an.tab === id ? 'active' : ''} onClick={() => setAn((a) => ({ ...a, tab: id }))}>{label}</button>
        ))}
      </div>

      <div className="an-body">
        {an.tab === 'compare' && <CompareTab A={A} B={B} clockMs={props.clockMs} />}
        {an.tab === 'surface' && <SurfaceTab A={A} B={B} an={an} setAn={setAn} onJump={props.onJump} onAnimate={props.onAnimate} />}
        {an.tab === 'graph' && <GraphTab A={A} B={B} an={an} setAn={setAn} />}
      </div>
    </aside>
  )
}
