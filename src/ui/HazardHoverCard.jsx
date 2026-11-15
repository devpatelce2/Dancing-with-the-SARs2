import React from 'react';
import { QUAKE_CLASSES } from '../data/quakeScale.js';

const fmt = (n, pos, neg) => `${Math.abs(n).toFixed(2)}° ${n >= 0 ? pos : neg}`;

const ALERT = { green: 'Green: little or no damage expected', yellow: 'Yellow: some damage possible', orange: 'Orange: significant damage likely', red: 'Red: extensive damage likely' };
/** Magnitude (energy at the source) and, when USGS provides it, shaking intensity (how hard the ground moved). */
function QuakeBlock({ q }) {
  return (
    <div className="qk" style={{ '--qk': q.cls.color }}>
      <div className="qk-main">
        <b className="qk-mag">M {q.mag.toFixed(1)}</b>
        <span className="qk-cls">{q.cls.label}</span>
        <span className="qk-bar" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= q.cls.level ? 'on' : ''} style={n <= q.cls.level ? { background: QUAKE_CLASSES[QUAKE_CLASSES.length - n].color } : undefined} />)}</span>
      </div>
      <dl className="qk-facts">
        {q.depthKm != null && <><dt>Depth</dt><dd>{q.depthKm.toFixed(0)} km{q.depthKm < 70 ? ' (shallow)' : q.depthKm < 300 ? ' (intermediate)' : ' (deep)'}</dd></>}
        <dt>Shaking</dt><dd>{q.shaking ? `${q.shaking.roman} · ${q.shaking.word} (max estimated, USGS)` : 'intensity not reported by USGS'}</dd>
        {q.felt && <><dt>Felt</dt><dd>{q.felt.roman} · {q.felt.word}{q.feltReports ? ` · ${q.feltReports.toLocaleString()} reports` : ''}</dd></>}
        {q.alert && <><dt>Impact</dt><dd className={`qk-alert ${q.alert}`}>{ALERT[q.alert]}</dd></>}
        {q.tsunami && <><dt>Tsunami</dt><dd>flagged by USGS for possible tsunami</dd></>}
      </dl>
    </div>
  );
}

/** Details for the hazard event(s) under the cursor. `place` and `sar` are resolved by the app for the first event. */
export default function HazardHoverCard({ hover, style }) {
  const { items, place, sar } = hover;
  const top = items[0];
  return (
    <div className="hz-hover" style={{ ...style, '--hz': top.color }} role="status">
      <div className="hz-head"><span>{top.glyph} {top.kind.toUpperCase()}</span><span>{items.length} event{items.length === 1 ? '' : 's'} here</span></div>
      {items.slice(0, 4).map((it) => (
        <div className="hz-item" key={it.id} style={{ '--hz': it.color }}>
          <strong>{it.title}</strong>
          {it.quake && <QuakeBlock q={it.quake} />}
          <span>{it.when}{it.ongoing ? ' · ongoing' : it.closed ? ` · closed ${it.closed}` : ''}{!it.quake && it.bits.length ? ` · ${it.bits.join(' · ')}` : ''}</span>
          <span className="hz-src">{it.source}{items.length > 1 ? ` · ${it.kind}` : ''}</span>
        </div>
      ))}
      {items.length > 4 && <small className="hz-more">+{items.length - 4} more events at this spot</small>}
      <dl className="hz-meta">
        {top.center && <><dt>Location</dt><dd>{place ? `${place} · ` : ''}{fmt(top.center[1], 'N', 'S')}, {fmt(top.center[0], 'E', 'W')}</dd></>}
        {sar && <><dt>SAR coverage</dt><dd className={sar.total ? 'ok' : ''}>{sar.total ? `${sar.total} scene${sar.total === 1 ? '' : 's'} in window (${sar.parts.join(', ')})` : 'none loaded for this window'}</dd></>}
      </dl>
      <div className="hz-foot">Click the marker for the full event record</div>
    </div>
  );
}
