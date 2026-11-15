import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapEngine } from './map/MapEngine.js';
import { BaseMapLayer } from './map/layers/BaseMapLayer.js';
import { GeographicLayer } from './map/layers/GeographicLayer.js';
import { SolarLightingLayer } from './map/layers/SolarLightingLayer.js';
import { ObservationLayer } from './map/layers/ObservationLayer.js';
import { HeatLayer } from './map/layers/HeatLayer.js';
import { RasterOverlayManager } from './map/layers/RasterOverlayManager.js';
import { createPlatform } from './platform.js';
import Sidebar from './ui/Sidebar.jsx';
import TimelineBar from './ui/TimelineBar.jsx';
import InspectorPopup from './ui/InspectorPopup.jsx';
import Legend from './ui/Legend.jsx';
import HazardHoverCard from './ui/HazardHoverCard.jsx';
import { hazardItemsForIds } from './data/hazardHover.js';
import TimeSeriesPanel from './components/TimeSeriesPanel.jsx';
import { fetchAcquisitions } from './data/asf.js';
import { fetchHazards, HAZARD_SOURCES } from './data/hazards.js';
import { createAcquisitionLayer, renderRecords, viewBoxDegrees, findHoveredAcquisitions } from './data/acquisitionLayer.js';

export default function App() {
  const platform = useMemo(createPlatform, []);
  const mapEl = useRef(null); const popupEl = useRef(null); const rootEl = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false); const [error, setError] = useState(null);
  const [info, setInfo] = useState(null); const pin = useRef(null);
  const [hoverInfo, setHoverInfo] = useState(null); const hoverKeyRef = useRef('');
  const [hazardHover, setHazardHover] = useState(null); const hazardKeyRef = useRef('');
  const [acqDisplayMode, setAcqDisplayMode] = useState('footprints');
  const acqDisplayModeRef = useRef('footprints');
  const acquisitionRecordsRef = useRef({ 'SENTINEL-1': [], NISAR: [] });
  const [stepKey, setStepKey] = useState('1 day'); const [speedKey, setSpeedKey] = useState('1 day/s');
  const [full, setFull] = useState(false);
  const [mode3d, setMode3d] = useState(false);
  // Which panels are showing. Each one slides away on its own; "clear map" hides or restores all three at once.
  const [panels, setPanels] = useState(() => { try { return { left: true, right: true, bottom: true, ...JSON.parse(localStorage.getItem('sar.panels') ?? '{}') }; } catch { return { left: true, right: true, bottom: true }; } });
  const restore = useRef(null);
  const setPanel = useCallback((k, v) => setPanels((p) => ({ ...p, [k]: v })), []);
  const allHidden = !panels.left && !panels.right && !panels.bottom;
  const toggleAll = () => setPanels((p) => { if (p.left || p.right || p.bottom) { restore.current = p; return { left: false, right: false, bottom: false }; } return restore.current ?? { left: true, right: true, bottom: true }; });
  useEffect(() => {
    try { localStorage.setItem('sar.panels', JSON.stringify(panels)); } catch { /* private mode: the layout just is not remembered */ }
    // the map area changes size while a panel slides: keep drawing until the slide has finished
    let n = 0; let id = requestAnimationFrame(function tick() { engineRef.current?.requestRender(); if (++n < 30) id = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(id);
  }, [panels]);
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [acqForm, setAcqForm] = useState({
    datasets: { 'SENTINEL-1': true, NISAR: true },
    levels: { 'SENTINEL-1': 'GRD_HD', NISAR: 'GCOV' },
    start: thirtyDaysAgo, end: today, extent: 'view', maxResults: 200,
  });
  const [acqStatus, setAcqStatus] = useState({ loading: false, error: null, messages: [], retrievedAt: null });
  const [hazardStatus, setHazardStatus] = useState({}); const [areaBounds, setAreaBounds] = useState(null);
  const heatRef = useRef(null); const obsRef = useRef([]); const [heatStats, setHeatStats] = useState(null);
  const [showReal, setShowReal] = useState(true); const showRealRef = useRef(true);
  showRealRef.current = showReal;
  const acqLayerRef = useRef(null);
  const acqAbortRef = useRef(null);
  const acqFormRef = useRef(acqForm); acqFormRef.current = acqForm;
  const loadAcquisitionsRef = useRef(null);
  const lastTimelineSearchRef = useRef('');

  useEffect(() => {
    let disposed = false; const cleanups = [];
    (async () => {
      try {
        const engine = new MapEngine(mapEl.current); engineRef.current = engine; window.__sarEngine = engine; // handy for debugging in the console
        const base = new BaseMapLayer(engine); const geo = new GeographicLayer(engine); const sun = new SolarLightingLayer(engine);
        const rasters = new RasterOverlayManager(engine); engine.rasters = rasters;
        const acquisitions = {
          'SENTINEL-1': createAcquisitionLayer(engine.viewer, 'sentinel-1-acquisitions'),
          NISAR: createAcquisitionLayer(engine.viewer, 'nisar-acquisitions'),
        };
        Object.values(acquisitions).forEach((source) => source.setMode(acqDisplayModeRef.current));
        acqLayerRef.current = acquisitions;
        await base.init(); await geo.init();
        const obs = platform.registry.list().filter((l) => l.group !== 'map').map((def) => new ObservationLayer(engine, platform.store, def));
        obsRef.current = obs;
        const heat = new HeatLayer(engine, platform, Object.keys(HAZARD_SOURCES)); heatRef.current = heat; cleanups.push(heat.subscribe(setHeatStats)); cleanups.push(() => heat.dispose());
        const apply = () => {
          const r = platform.registry; const win = platform.timeline.getWindow();
          geo.setLabelsVisible(r.get('labels').visible); geo.setBoundariesVisible(r.get('boundaries').visible); sun.setVisible(r.get('daynight').visible);
          obs.forEach((l) => { l.visible = r.get(l.def.id).visible; l.setWindow(win); });
        };
        cleanups.push(platform.registry.subscribe(apply));
        cleanups.push(platform.store.subscribe((id) => obs.find((l) => l.def.id === id)?.refresh()));
        cleanups.push(platform.timeline.subscribe((s) => { sun.setTime(s.time); const win = platform.timeline.getWindow(); obs.forEach((l) => l.setWindow(win)); }));
        sun.setTime(platform.timeline.getState().time); apply();
        // click-to-inspect
        cleanups.push(engine.onMouseMove(({ lon, lat, windowPos, pickedIds } = {}) => {
          // 1) hazard events (floods, quakes, ...) under the cursor take priority over SAR footprints
          const items = windowPos ? hazardItemsForIds(pickedIds, platform.store, platform.registry) : [];
          const away = (it) => (it.center ? Math.hypot(it.center[0] - lon, it.center[1] - lat) : Infinity);
          items.sort((a, b) => away(a) - away(b)); // nearest event to the cursor leads the card
          engine.scene.canvas.style.cursor = items.length ? 'pointer' : '';
          const hkey = items.map((i) => i.id).join('|');
          if (hkey !== hazardKeyRef.current) {
            hazardKeyRef.current = hkey;
            if (!items.length) setHazardHover(null);
            else {
              const c = items[0].center; const cov = findHoveredAcquisitions(acquisitionRecordsRef.current, c[0], c[1]);
              const parts = Object.entries(cov.reduce((g, r) => { g[r.dataset] = (g[r.dataset] || 0) + 1; return g; }, {})).map(([k, n]) => `${k === 'NISAR' ? 'NISAR' : 'Sentinel-1'} ${n}`);
              const sar = { total: cov.length, parts };
              setHazardHover({ items, x: windowPos.x, y: windowPos.y, place: null, sar });
              platform.inspector.inspect(c[0], c[1]).then((d) => { if (hazardKeyRef.current === hkey) setHazardHover((h) => (h && h.items[0].id === items[0].id ? { ...h, place: d.name } : h)); }).catch(() => {});
            }
          } else if (items.length) setHazardHover((h) => (h ? { ...h, x: windowPos.x, y: windowPos.y } : h));
          if (items.length) { setHoverInfo(null); hoverKeyRef.current = ''; return; }
          if (!windowPos || !showRealRef.current) { setHoverInfo(null); hoverKeyRef.current = ''; return; }
          const matches = findHoveredAcquisitions(acquisitionRecordsRef.current, lon, lat);
          const key = matches.map(r => r.id).sort().join('|');
          if (key !== hoverKeyRef.current) {
            hoverKeyRef.current = key;
            setHoverInfo(matches.length ? { records: matches, x: windowPos.x, y: windowPos.y } : null);
          }
        }));
        cleanups.push(engine.onClick(async ({ lon, lat }) => {
          const data = await platform.inspector.inspect(lon, lat);
          pin.current = { lon, lat }; setInfo(data);
        }));
        cleanups.push(engine.onPostRender(() => {
          if (!pin.current || !popupEl.current) return;
          const p = engine.toWindow(pin.current.lon, pin.current.lat);
          if (p) popupEl.current.style.transform = `translate(${Math.round(p.x + 12)}px, ${Math.round(p.y - 12)}px)`;
        }));
        cleanups.push(() => { obs.forEach((l) => l.dispose()); geo.dispose(); sun.dispose(); base.dispose(); Object.values(acquisitions).forEach((source) => engine.viewer.dataSources.remove(source, true)); acqLayerRef.current = null; engine.destroy(); });
        if (!disposed) setReady(true);
      } catch (e) { console.error(e); setError(e.message ?? String(e)); }
    })();
    const fs = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', fs);
    return () => { disposed = true; acqAbortRef.current?.abort(); document.removeEventListener('fullscreenchange', fs); cleanups.forEach((c) => c()); };
  }, [platform]);

  const eng = () => engineRef.current;

  // Area + event filter: pick hazard layer(s), restrict to the selected box, widen the time window, fly there, show thermal overlay.
  const applyArea = ({ bounds, event }) => {
    for (const id of Object.keys(HAZARD_SOURCES)) platform.registry.setVisible(id, event === 'all' || event === id);
    platform.timeline.setWindow(30 * 86400e3);
    obsRef.current.forEach((l) => l.setBounds?.(bounds)); setAreaBounds(bounds);
    heatRef.current?.setArea(bounds);
    if (bounds) eng()?.flyToBounds(bounds); else eng()?.resetView();
  };
  const focusEvent = ([lon, lat]) => eng()?.flyToBounds([lon - 1.5, lat - 1, lon + 1.5, lat + 1]);
  const clearArea = () => { setAreaBounds(null); obsRef.current.forEach((l) => l.setBounds?.(null)); heatRef.current?.setArea(null); };

  const loadAcquisitions = async (options = {}) => {
    const form = acqFormRef.current;
    const selected = Object.keys(form.datasets).filter((key) => form.datasets[key]);
    if (!selected.length) return;

    const start = Number.isFinite(options.startMs) ? new Date(options.startMs).toISOString() : `${form.start}T00:00:00Z`;
    const end = Number.isFinite(options.endMs) ? new Date(options.endMs).toISOString() : `${form.end}T23:59:59Z`;
    const bbox = form.extent === 'view' ? viewBoxDegrees(eng()?.viewer) : null;
    const bboxKey = bbox ? Object.values(bbox).map(v => v.toFixed(2)).join(',') : 'global';
    const searchKey = `${selected.join(',')}|${start}|${end}|${bboxKey}|${selected.map(k => form.levels[k]).join(',')}`;
    if (options.auto && searchKey === lastTimelineSearchRef.current) return;
    if (options.auto) lastTimelineSearchRef.current = searchKey;

    acqAbortRef.current?.abort();
    const controller = new AbortController(); acqAbortRef.current = controller;
    setAcqStatus({ loading: true, error: null, messages: [{ text: options.auto ? 'Timeline changed · searching ASF acquisitions…' : 'Searching ASF acquisitions…' }], retrievedAt: null });

    try {
      const results = await Promise.allSettled(selected.map((dataset) => fetchAcquisitions({
        dataset, start, end, bbox, processingLevel: form.levels[dataset], maxResults: form.maxResults,
      }, { signal: controller.signal })));
      if (controller.signal.aborted) return;
      const messages = [];
      let retrievedAt = null;
      let totalRecords = 0;
      results.forEach((result, i) => {
        const dataset = selected[i];
        const layerId = dataset === 'NISAR' ? 'nisar' : 'sentinel1';
        const source = acqLayerRef.current?.[dataset];
        if (result.status === 'rejected') {
          if (result.reason?.name !== 'AbortError') messages.push({ warn: true, text: `${dataset}: ${result.reason?.message || 'Search failed'}` });
          acquisitionRecordsRef.current[dataset] = [];
          if (source) renderRecords(source, []);
          return;
        }
        const r = result.value;
        retrievedAt = r.retrievedAt;
        totalRecords += r.records.length;
        acquisitionRecordsRef.current[dataset] = r.records;
        if (source) { renderRecords(source, r.records); source.setMode(acqDisplayModeRef.current); }
        platform.registry.setStatus(layerId, 'integrated');
        platform.registry.setVisible(layerId, r.records.length > 0);
        messages.push({ text: `${dataset}: ${r.records.length} acquisitions in selected timeline window${r.total != null ? ` · ${r.total.toLocaleString()} catalogue matches` : ''}${r.truncated ? ' · result cap reached' : ''}.` });
        const rejected = Object.values(r.rejected || {}).reduce((a, b) => a + b, 0);
        if (rejected) messages.push({ warn: true, text: `${dataset}: ${rejected} records skipped because required footprint or metadata fields were missing.` });
      });
      if (!totalRecords && !messages.some(m => m.warn)) messages.push({ warn: true, text: 'No acquisitions found in this timeline window and map area.' });
      setAcqStatus({ loading: false, error: totalRecords ? null : 'No usable acquisition footprints were found for this timeline window.', messages, retrievedAt });
    } catch (e) {
      if (e?.name !== 'AbortError') setAcqStatus({ loading: false, error: e.message || 'ASF search failed', messages: [], retrievedAt: null });
    }
  };
  loadAcquisitionsRef.current = loadAcquisitions;

  useEffect(() => {
    if (!ready) return undefined;
    const timeline = platform.timeline;
    let timer = null;
    const scheduleSearch = (state) => {
      if (timer) clearTimeout(timer);
      // During animation playback, wait until the user pauses; this avoids a network
      // request on every animation frame. Scrubbing/date changes search after a short settle.
      if (state.playing) return;
      timer = setTimeout(() => {
        const window = timeline.getWindow();
        loadAcquisitionsRef.current?.({ startMs: window.start, endMs: window.end, auto: true });
      }, 450);
    };
    const unsubscribe = timeline.subscribe(scheduleSearch);
    scheduleSearch(timeline.getState());
    return () => { if (timer) clearTimeout(timer); unsubscribe(); };
  }, [platform, ready]);

  // Disaster layers: when a layer is switched on (or the timeline range changes) fetch REAL events for that range.
  useEffect(() => {
    if (!ready) return undefined;
    const loaded = {}; const ctrls = {}; let timer = null;
    const sync = () => {
      const { start, end } = platform.timeline.getState();
      const key = `${Math.floor(start / 86400e3)}-${Math.floor(end / 86400e3)}`;
      for (const id of Object.keys(HAZARD_SOURCES)) {
        const visible = !!platform.registry.get(id)?.visible;
        if (!visible || loaded[id] === key) continue;
        loaded[id] = key; ctrls[id]?.abort(); const c = new AbortController(); ctrls[id] = c;
        setHazardStatus((s) => ({ ...s, [id]: { loading: true } }));
        fetchHazards(id, start, end, { signal: c.signal }).then((r) => {
          platform.store.clear(id); platform.store.add(id, r.observations);
          platform.registry.setStatus(id, 'integrated');
          setHazardStatus((s) => ({ ...s, [id]: { count: r.observations.length, source: r.source, retrievedAt: r.retrievedAt } }));
        }).catch((e) => {
          if (e?.name === 'AbortError') return;
          loaded[id] = null; setHazardStatus((s) => ({ ...s, [id]: { error: e.message || 'fetch failed' } }));
        });
      }
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(sync, 400); };
    const u1 = platform.registry.subscribe(later); const u2 = platform.timeline.subscribe((s) => { if (!s.playing) later(); });
    return () => { clearTimeout(timer); u1(); u2(); Object.values(ctrls).forEach((c) => c?.abort()); };
  }, [platform, ready]);

  useEffect(() => {
    acqDisplayModeRef.current = acqDisplayMode;
    Object.values(acqLayerRef.current || {}).forEach((source) => source.setMode(acqDisplayMode));
  }, [acqDisplayMode]);

  const clearAcquisitions = () => {
    if (acqLayerRef.current) Object.values(acqLayerRef.current).forEach((source) => renderRecords(source, []));
    acquisitionRecordsRef.current = { 'SENTINEL-1': [], NISAR: [] };
    setHoverInfo(null); hoverKeyRef.current = '';
    platform.registry.setVisible('sentinel1', false); platform.registry.setVisible('nisar', false);
    platform.registry.setStatus('sentinel1', 'future'); platform.registry.setStatus('nisar', 'future');
    setAcqStatus({ loading: false, error: null, messages: [], retrievedAt: null });
  };
  const toggleMode = () => { const e = eng(); if (e) setMode3d(e.setMode(mode3d ? '2D' : '3D') === '3D'); };
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : rootEl.current.requestFullscreen?.());
  const closePopup = () => { pin.current = null; setInfo(null); };
  useEffect(() => {
    if (!showReal) { setHoverInfo(null); hoverKeyRef.current = ''; }
    const syncAcquisitionVisibility = () => {
      if (!acqLayerRef.current) return;
      acqLayerRef.current['SENTINEL-1'].show = showReal && !!platform.registry.get('sentinel1')?.visible;
      acqLayerRef.current.NISAR.show = showReal && !!platform.registry.get('nisar')?.visible;
    };
    syncAcquisitionVisibility();
    return platform.registry.subscribe(syncAcquisitionVisibility);
  }, [platform, showReal]);

  return (
    <div className={`app${panels.left ? '' : ' no-left'}${panels.bottom ? '' : ' no-bottom'}`} ref={rootEl}>
      <Sidebar open={panels.left} onClose={() => setPanel('left', false)} platform={platform} hazardStatus={hazardStatus} area={{ onApply: applyArea, onClear: clearArea, heatStats }} feed={{ bounds: areaBounds, onFocus: focusEvent }} timelineStart={platform.timeline.getState().start} acquisition={{ form: acqForm, setForm: setAcqForm, status: acqStatus, onLoad: loadAcquisitions, onClear: clearAcquisitions, showReal, setShowReal }} />
      <main className="stage">
        <div className="map" ref={mapEl} />
        {!ready && !error && <div className="overlay">Loading global map…</div>}
        {error && <div className="overlay err">Map failed to start: {error}</div>}
        {!panels.left && <button className="pedge left" onClick={() => setPanel('left', true)} aria-label="Show side panel" title="Show side panel">›<span>Menu</span></button>}
        {!panels.bottom && <button className="pedge bottom" onClick={() => setPanel('bottom', true)} aria-label="Show timeline" title="Show timeline">▴<span>Timeline</span></button>}
        <div className="controls" aria-label="Map controls">
          <button onClick={() => eng()?.zoom(2)} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={() => eng()?.zoom(0.5)} title="Zoom out" aria-label="Zoom out">−</button>
          <button onClick={() => eng()?.resetView()} title="Reset to global view" aria-label="Reset view">⌂</button>
          <button className={`clearmap${allHidden ? ' on' : ''}`} onClick={toggleAll} aria-pressed={allHidden} title={allHidden ? 'Show the panels again' : 'Hide all panels for a clear map'} aria-label={allHidden ? 'Show panels' : 'Hide all panels'}>{allHidden ? '◧' : '▢'}</button>
          <button className={`mode3d${mode3d ? ' on' : ''}`} onClick={toggleMode} disabled={!ready} aria-pressed={mode3d} title={mode3d ? 'Switch to the flat map' : 'Switch to the 3D globe'} aria-label={mode3d ? 'Switch to flat map' : 'Switch to 3D globe'}>{mode3d ? '2D' : '3D'}</button>
          <button onClick={toggleFull} title="Full screen" aria-label="Full screen">{full ? '⤡' : '⤢'}</button>
        </div>
        <div className="acq-mode-switch" role="group" aria-label="Acquisition visualization">
          <span>OBSERVATIONS</span>
          <button className={acqDisplayMode === 'footprints' ? 'active' : ''} onClick={() => setAcqDisplayMode('footprints')}>Footprints</button>
          <button className={acqDisplayMode === 'density' ? 'active' : ''} onClick={() => setAcqDisplayMode('density')}>Density</button>
        </div>
        <Legend platform={platform} />
        <TimeSeriesPanel engineRef={engineRef} ready={ready} open={panels.right} onOpenChange={(v) => setPanel('right', v)} />
        <div ref={popupEl} className="popup-anchor"><InspectorPopup info={info} onClose={closePopup} /></div>
        {hazardHover && <HazardHoverCard hover={hazardHover} style={{ left: Math.min(hazardHover.x + 18, (mapEl.current?.clientWidth || 900) - 340), top: Math.max(12, Math.min(hazardHover.y + 14, (mapEl.current?.clientHeight || 600) - 250)) }} />}
        {hoverInfo && !hazardHover && <div className="acq-hover-card" style={{ left: Math.min(hoverInfo.x + 16, (mapEl.current?.clientWidth || 900) - 330), top: Math.max(12, Math.min(hoverInfo.y + 14, (mapEl.current?.clientHeight || 600) - 230)) }}>
          <div className="acq-hover-head"><span>◉ LIVE SAR OBSERVATION</span><span>{hoverInfo.records.length} scene{hoverInfo.records.length === 1 ? '' : 's'}</span></div>
          {Object.entries(hoverInfo.records.reduce((groups, r) => { (groups[r.dataset] ||= []).push(r); return groups; }, {})).map(([dataset, records]) => <section className="acq-hover-group" key={dataset}>
            <h4><i style={{ background: dataset === 'NISAR' ? '#ffb454' : '#5fb4ff' }} />{dataset === 'NISAR' ? 'NISAR' : 'SENTINEL-1'} <small>{records.length} acquisition{records.length === 1 ? '' : 's'}</small></h4>
            {records.slice(0, 4).map(r => <div className="acq-hover-record" key={r.id}>
              <strong>{r.sceneName || r.platform}</strong>
              <span>{r.startTime ? new Date(r.startTime).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'Acquisition time unavailable'}</span>
              <span>{[r.processingLevel, r.polarization, r.flightDirection].filter(Boolean).join(' · ') || 'Metadata available in catalogue'}</span>
            </div>)}
            {records.length > 4 && <small className="acq-hover-more">+{records.length - 4} more scenes in this area</small>}
          </section>)}
          <div className="acq-hover-foot">Hover shows catalogue footprints, not radar pixel intensity</div>
        </div>}
        <div className="attribution">ASF DAAC acquisition footprints · Natural Earth · NOAA solar algorithm · CesiumJS</div>
      </main>
      <div className="tl-wrap" aria-hidden={!panels.bottom} inert={panels.bottom ? undefined : ''}>
        <button className="tl-hide" onClick={() => setPanel('bottom', false)} aria-label="Hide timeline" title="Hide timeline">▾</button>
        <TimelineBar timeline={platform.timeline} stepKey={stepKey} setStepKey={setStepKey} speedKey={speedKey} setSpeedKey={setSpeedKey} acquisitionStatus={acqStatus} />
      </div>
    </div>
  );
}
