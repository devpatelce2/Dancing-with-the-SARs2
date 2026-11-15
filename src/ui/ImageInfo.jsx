import React, { useState } from 'react';

/** Attribution card for every radar image currently on the map. Collapsed to one line; expands to the full metadata. */
export default function ImageInfo({ images }) {
  const [open, setOpen] = useState(false);
  if (!images?.length) return null;
  return (
    <aside className={`img-info${open ? ' open' : ''}`} aria-label="Radar image source and metadata">
      <button className="img-info-head" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Hide image details' : 'Show source and metadata for the radar image on the map'}>
        <span className="img-info-tag">{images.some((i) => i.synthetic) ? 'SYNTHETIC IMAGE' : 'RADAR IMAGE'}</span>
        <span className="img-info-title">{images.map((i) => i.title).join('  |  ')}</span>
        <span aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      {open && <div className="img-info-body">{images.map((img, k) => (
        <dl key={img.id}>
          {images.length > 1 && <dt className="img-info-side">{k === 0 ? 'Left' : 'Right'} image</dt>}
          {img.rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
        </dl>))}</div>}
    </aside>
  );
}
