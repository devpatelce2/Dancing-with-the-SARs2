import React from 'react';
import { describe, GLYPH } from '../components/EventFeed.jsx';
const f = (n, pos, neg) => `${Math.abs(n).toFixed(4)}° ${n >= 0 ? pos : neg}`;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

function Group({ title, items }) {
  return (
    <div className="grp">
      <h4>{title}</h4>
      {items.map(({ layer, loaded, here }) => (
        <div key={layer.id} className="obs">
          <b>{layer.label}</b>
          {here.length ? (
            <ul>{here.slice(0, 5).map((o) => (
              <li key={o.id}>{o.properties.kind === 'disaster' ? (() => { const d = describe(o); return <><span>{GLYPH[layer.id]} <b>{d.title}</b></span><br />{d.when}{d.bits.length ? ` · ${d.bits.join(' · ')}` : ''} · {o.properties.source}{d.link && <> · <a href={d.link} target="_blank" rel="noreferrer">details</a></>}</> })() : <><code>{o.properties.productId}</code><br />{o.properties.timestamp}</>}
                {o.properties.orbitDirection ? ` · ${o.properties.orbitDirection}` : ''}{o.properties.polarization ? ` · ${o.properties.polarization}` : ''}
                <span className={`badge ${o.properties.verificationStatus === 'verified' ? 'live' : 'test'}`}>{o.properties.verificationStatus}</span></li>))}
              {here.length > 5 && <li>+{here.length - 5} more</li>}</ul>
          ) : (
            <span className="none">{layer.status === 'future' ? ' not connected' : loaded ? ' none at this point in this time window' : ' no data loaded'}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function InspectorPopup({ info, style, onClose }) {
  if (!info) return null;
  return (
    <div className="popup" style={style} role="dialog" aria-label="Location information">
      <button className="x" onClick={onClose} aria-label="Close">×</button>
      <h3>{info.name ?? 'Unnamed location'}</h3>
      <dl>
        <dt>Coordinates</dt><dd>{f(info.lat, 'N', 'S')}, {f(info.lon, 'E', 'W')}</dd>
        {info.country && <><dt>Country</dt><dd>{info.country.name}{info.country.iso2 ? ` (${info.country.iso2})` : ''} · <code>{info.country.id}</code>{info.country.sovereign && info.country.sovereign !== info.country.name ? ` · sovereign: ${info.country.sovereign}` : ''}</dd></>}
        {info.region && <><dt>Region</dt><dd>{info.region}</dd></>}
        {info.water?.length > 0 && <><dt>Water body</dt><dd>{info.water.join(', ')}</dd></>}
        {!info.country && !info.water?.length && <><dt>Area</dt><dd>No country or named water body in the reference data</dd></>}
      </dl>
      <p className="win">Time window: {iso(info.window.start)} → {iso(info.window.end)}</p>
      <Group title="Satellite observations" items={info.satellite} />
      <Group title="Disaster events" items={info.disaster} />
    </div>
  );
}
