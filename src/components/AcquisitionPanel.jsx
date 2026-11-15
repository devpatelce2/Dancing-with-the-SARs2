import { DATASETS, MAX_RESULTS_CAP } from '../data/asf.js'

const TODAY = new Date().toISOString().slice(0, 10)

/** Search the live ASF catalog and display acquisition footprints on the map. */
export default function AcquisitionPanel({ form, setForm, status, onLoad, onClear, showReal, setShowReal }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggleDataset = (key) => set({ datasets: { ...form.datasets, [key]: !form.datasets[key] } })
  const setLevel = (key, value) => set({ levels: { ...form.levels, [key]: value } })

  return (
    <section className="acq-panel">
      <div className="section-heading"><span>LIVE SAR CATALOG · ASF DAAC</span><span aria-hidden="true">◉</span></div>
      <p className="acq-help">Search real Sentinel-1 and NISAR catalogue metadata. Footprints and the Density view show where and when satellites looked: density counts overlapping scenes. They are catalogue records, not radar brightness. Hover for scene details.</p>

      <div className="acq-row">
        {Object.entries(DATASETS).map(([key, d]) => (
          <label key={key} className="acq-chip" style={{ '--chip': d.color }}>
            <input type="checkbox" checked={!!form.datasets[key]} onChange={() => toggleDataset(key)} />
            <i /> {d.label}
          </label>
        ))}
      </div>

      {Object.entries(DATASETS).map(([key, d]) => form.datasets[key] && (
        <label className="acq-level" key={key}>{d.label} product
          <select value={form.levels[key] || d.defaultLevel} onChange={(e) => setLevel(key, e.target.value)}>
            {d.levels.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
      ))}

      <div className="acq-grid">
        <label>From
          <input type="date" min="2014-04-03" max={form.end || TODAY} value={form.start}
            onChange={(e) => set({ start: e.target.value })} />
        </label>
        <label>To
          <input type="date" min={form.start || '2014-04-03'} max={TODAY} value={form.end}
            onChange={(e) => set({ end: e.target.value })} />
        </label>
      </div>

      <div className="acq-grid">
        <label>Search area
          <select value={form.extent} onChange={(e) => set({ extent: e.target.value })}>
            <option value="view">Current map view</option>
            <option value="global">Global (sampled)</option>
          </select>
        </label>
        <label>Max / mission
          <input type="number" min="10" max={MAX_RESULTS_CAP} step="50" value={form.maxResults}
            onChange={(e) => set({ maxResults: Math.max(10, Math.min(MAX_RESULTS_CAP, Number(e.target.value) || 10)) })} />
        </label>
      </div>

      <div className="acq-actions">
        <button className="acq-btn primary" onClick={onLoad} disabled={status.loading || !Object.values(form.datasets).some(Boolean)}>
          <span className={status.loading ? 'spin' : ''} aria-hidden="true">↻</span>
          {status.loading ? 'Searching ASF…' : 'Search live acquisitions'}
        </button>
        <button className="acq-btn" onClick={onClear} disabled={status.loading}>Clear</button>
      </div>

      <label className="layer-toggle acq-toggle">
        <div className="layer-copy"><strong>Show acquisition footprints</strong><small>Catalogue coverage, not radar brightness</small></div>
        <input type="checkbox" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} />
      </label>

      {status.error && <p className="error-text">⚠ {status.error}</p>}
      {status.messages.map((m, i) => <p key={i} className={`acq-msg ${m.warn ? 'warn' : ''}${m.full ? ' full' : ''}`}>{m.text}</p>)}
      {status.retrievedAt && <p className="muted small">Retrieved {new Date(status.retrievedAt).toUTCString()} · UTC</p>}
    </section>
  )
}
