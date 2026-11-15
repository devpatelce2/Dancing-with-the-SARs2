import React from 'react';
import { useRegistry, useStoreVersion } from './hooks.js';
import { QUAKE_CLASSES, quakeSize } from '../data/quakeScale.js';
import { COVERAGE_CLASSES } from '../data/acquisitionWindow.js';
/** Compact legend: appears only for layers that are on AND currently have loaded data (plus the day/night key). */
export default function Legend({ platform, acqMode = 'footprints' }) {
  const { registry, store } = platform; useRegistry(registry); useStoreVersion(store);
  const active = registry.list().filter((l) => l.group !== 'map' && l.visible && store.count(l.id) > 0);
  const dn = registry.get('daynight').visible;
  const acq = ['sentinel1', 'nisar'].filter((id) => registry.get(id)?.visible);
  if (!active.length && !dn && !acq.length) return null;
  return (
    <div className="legend">
      {active.some((l) => l.id === 'earthquakes') && <div className="lg-quake" aria-label="Earthquake magnitude scale">
        <span className="lg-t">Earthquake magnitude</span>
        <div className="lg-scale">{[...QUAKE_CLASSES].reverse().map((c, i) => { const m = [4.5, 5, 6, 7, 8][i]; const d = Math.round(quakeSize(m + 0.4) * 0.62); return (
          <span key={c.label} title={`${c.label}: M ${i === 0 ? '4.5 to 4.9' : i === 4 ? '8 and above' : `${m} to ${m}.9`}`}><i style={{ background: c.color, width: d, height: d }} /><em>{i === 4 ? '8+' : m}</em><small>{c.label}</small></span>) })}</div>
      </div>}
      {acq.length > 0 && acqMode === 'density' && <div className="lg-cov" aria-label="Acquisition coverage scale">
        <span className="lg-t">Acquisition coverage</span>
        <div className="lg-scale">{COVERAGE_CLASSES.map((c) => <span key={c.label}><i style={{ background: `rgba(90,209,245,${c.alpha})` }} /><small>{c.label}</small></span>)}</div>
        <p>Counts how many scenes cover each point. It is not radar brightness: it says where satellites looked, not what they saw.</p>
      </div>}
      {acq.length > 0 && acqMode === 'footprints' && <div className="lg"><i className="fp" /> Footprint: the ground one scene covers (outline), for scenes starting inside the timeline window</div>}
      {dn && <div className="lg"><i className="grad" /> Night (darker = further below horizon; twilight ramps to −18°)</div>}
      {active.map((l) => <div className="lg" key={l.id}><i className={l.group === 'disaster' ? 'dot' : ''} style={{ background: l.color ?? '#ff7a59' }} /> {l.label} {l.group === 'disaster' ? `· ${store.count(l.id)} events (${l.id === 'earthquakes' ? 'size and colour = magnitude' : 'marker size = magnitude'})` : 'footprints'}{l.status === 'test' ? ' (user-supplied)' : ''}</div>)}
    </div>
  );
}
