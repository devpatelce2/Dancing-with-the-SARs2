import React, { useCallback, useRef, useState } from 'react';
import TeamLogo, { StellarisMark } from './TeamLogo.jsx';
import { useRegistry, useStoreVersion } from './hooks.js';
import AcquisitionPanel from '../components/AcquisitionPanel.jsx';
import AreaPanel from '../components/AreaPanel.jsx';
import EventFeed from '../components/EventFeed.jsx';

// Official challenge resources (opened in a new tab; nothing is fetched from them by the app except the ASF catalogue).
const RESOURCES = [
  ['ASF Vertex · NISAR data search', 'https://search.asf.alaska.edu/', 'used'],
  ['NASA Earthdata Search', 'https://search.earthdata.nasa.gov/search', 'used'],
  ['NISAR Data User Guide', 'https://nisar-docs.asf.alaska.edu/', 'used'],
  ['Remote sensing basics', 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing'],
  ['NASA ARSET training', 'https://appliedsciences.nasa.gov/get-involved/training'],
  ['NISAR StoryMaps', 'https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/'],
  ['NISAR societal benefit', 'https://nisar.jpl.nasa.gov/applications/societal-benefit/'],
  ['UAVSAR postcards', 'https://uavsar.jpl.nasa.gov/education/postcards.html'],
  ['CSA RADARSAT Constellation', 'https://donnees-data.asc-csa.gc.ca/en/dataset/rcm'],
  ['CSA SAR tutorial (GitHub)', 'https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial'],
  ['CSA RADARSAT-1', 'https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1'],
  ['CONAE SAOCOM catalogue', 'https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html'],
  ['SAOCOM open access (news)', 'https://www.argentina.gob.ar/noticias/la-informacion-saocom-cada-vez-mas-accesible'],
];

const STATUS = {
  integrated: { text: 'Live', cls: 'live', tip: 'Backed by verified source data' },
  test: { text: 'Test', cls: 'test', tip: 'User-supplied data, not independently verified' },
  future: { text: 'Not connected', cls: 'future', tip: 'Registered for a future milestone — no data source connected' },
};

// NOTE: do not wrap Row in React.memo. LayerRegistry mutates layer objects in place, so `layer` keeps the same
// reference when visibility changes and a memoised row would never re-render (toggle looks dead).
function Row({ layer, count, onToggle, children }) {
  const st = STATUS[layer.status];
  return (
    <div className="row">
      <label className="toggle" title={layer.status === 'future' && layer.group === 'disaster' ? 'Tick to load live events for the timeline window' : st.tip}>
        <input type="checkbox" checked={layer.visible} onChange={() => onToggle(layer.id)} />
        <span className="swatch" style={{ background: layer.visible ? layer.color ?? 'var(--accent)' : 'transparent', borderColor: layer.color ?? 'var(--accent)' }} />
        <span className="name">{layer.label}</span>
      </label>
      <span className={`badge ${st.cls}`} title={st.tip}>{layer.status === 'future' ? (layer.group === 'disaster' ? 'Tick to load' : st.text) : `${st.text}${count != null ? ` · ${count}` : ''}`}</span>
      {children}
    </div>
  );
}

const TABS = [['explore', 'Explore', 'Pick a place and see events there'], ['satellites', 'Satellites', 'Search live radar scenes'], ['layers', 'Layers', 'Turn map and hazard layers on or off'], ['about', 'About', 'Data sources and credits']];

export default function Sidebar({ platform, onImported, acquisition, hazardStatus = {}, area, feed, timelineStart, open = true, onClose }) {
  const [tab, setTab] = useState('explore');
  const onTabKey = (e) => { // arrow keys move between tabs, as people expect from a tab list
    const i = TABS.findIndex((t) => t[0] === tab); const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
    const next = TABS[(i + d + TABS.length) % TABS.length][0]; setTab(next); e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
  };
  const { registry, store, importGeoJSON } = platform;
  useRegistry(registry); useStoreVersion(store);
  const file = useRef(null); const [msg, setMsg] = useState(null);
  const toggle = useCallback((id) => registry.toggle(id), [registry]);
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    try { const r = importGeoJSON(JSON.parse(await f.text())); const n = Object.values(r.added).reduce((a, b) => a + b, 0);
      setMsg({ ok: true, text: `${n} footprints imported${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.` }); onImported?.(r); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  return (
    <aside className={`sidebar${open ? '' : ' closed'}`} aria-hidden={!open} inert={open ? undefined : ''}>
      <header className="sb-head">
        <StellarisMark size={38} />
        <div className="sb-title"><h1>Dancing with the SARs</h1><p>Global Earth Map</p><span className="sb-team">by Team Stellaris</span></div>
        {onClose && <button className="sb-close" onClick={onClose} aria-label="Hide side panel" title="Hide side panel">‹</button>}
      </header>
      <div className="sb-tabs" role="tablist" aria-label="Side panel sections" onKeyDown={onTabKey}>
        {TABS.map(([id, label, tip]) => <button key={id} role="tab" data-tab={id} id={`sbt-${id}`} aria-selected={tab === id} aria-controls={`sbp-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'on' : ''} title={tip} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {/* every section stays mounted, so a search or a filter keeps its state when you switch tabs */}
      <div className="sb-body" role="tabpanel" id="sbp-explore" aria-labelledby="sbt-explore" hidden={tab !== 'explore'}>
      {area && <AreaPanel {...area} />}
      {feed && <EventFeed platform={platform} {...feed} />}
      </div>
      <div className="sb-body" role="tabpanel" id="sbp-satellites" aria-labelledby="sbt-satellites" hidden={tab !== 'satellites'}>
      {acquisition && <AcquisitionPanel {...acquisition} />}
      </div>
      <div className="sb-body" role="tabpanel" id="sbp-layers" aria-labelledby="sbt-layers" hidden={tab !== 'layers'}>
      <section>
        <h2>Map</h2>
        {registry.list('map').map((l) => <Row key={l.id} layer={l} onToggle={toggle} />)}
      </section>
      <section>
        <h2>Data layers</h2>
        <h3>Satellite missions</h3>
        {registry.list('satellite').map((l) => <Row key={l.id} layer={l} count={store.count(l.id)} onToggle={toggle} />)}
        <button className="link" onClick={() => file.current.click()} title="Import footprints exported from ASF Vertex / asf_search (GeoJSON)">+ Import footprints (GeoJSON)</button>
        <input ref={file} type="file" accept=".geojson,.json,application/geo+json,application/json" hidden onChange={onFile} />
        {msg && <p className={`note ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
        <h3>Natural disasters</h3>
        {registry.list('disaster').map((l) => <React.Fragment key={l.id}><Row layer={l} count={store.count(l.id)} onToggle={toggle} />
          {hazardStatus[l.id]?.loading && <p className="note">Loading real events…</p>}
          {hazardStatus[l.id]?.error && <p className="note err">{hazardStatus[l.id].error}</p>}
          {hazardStatus[l.id]?.source && <p className="note ok">{hazardStatus[l.id].count} events · {hazardStatus[l.id].source} · retrieved {hazardStatus[l.id].retrievedAt.slice(0, 16).replace('T', ' ')} UTC</p>}</React.Fragment>)}
      </section>
      </div>
      <div className="sb-body" role="tabpanel" id="sbp-about" aria-labelledby="sbt-about" hidden={tab !== 'about'}>
        <section className="team-card"><TeamLogo size={52} /><p>Built by <b>Team Stellaris</b> for the NASA Space Apps Challenge 2026, &ldquo;Dancing with the SARs&rdquo;. Radar data: NASA/ISRO NISAR and ESA Sentinel-1, via ASF DAAC.</p></section>
      <section>
        <h2>Data &amp; resources</h2>
        <ul className="res">
          {RESOURCES.map(([label, url, used]) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{label}</a>{used && <span className="badge live" title="Used by this app or its processing pipeline">in use</span>}</li>)}
        </ul>
      </section>
      <footer>
        <p><b>Footprints: live from ASF DAAC. Surface change: NISAR GCOV processed by this project&apos;s pipeline.</b> Disaster layers load real events: earthquakes from USGS, other hazards from NASA EONET, for the timeline range.</p>
        <p className="attrib">Basemap &amp; boundaries: Natural Earth (public domain). Day/night: NOAA solar algorithm.</p>
      </footer>
      </div>
    </aside>
  );
}
