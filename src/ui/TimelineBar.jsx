import React from 'react';
import { useTimeline } from './hooks.js';
import { STEPS, SPEEDS } from '../core/time/timeController.js';

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const timeStr = (ms) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const parseUtc = (date, time) => Date.parse(`${date}T${time || '00:00'}:00Z`);

export default function TimelineBar({ timeline, stepKey, setStepKey, speedKey, setSpeedKey, acquisitionStatus }) {
  const s = useTimeline(timeline);
  const setDate = (e) => { const t = parseUtc(e.target.value, timeStr(s.time)); if (!Number.isNaN(t)) timeline.setTime(t); };
  const setClock = (e) => { const t = parseUtc(dateStr(s.time), e.target.value); if (!Number.isNaN(t)) timeline.setTime(t); };
  const setStart = (e) => { const t = Date.parse(`${e.target.value}T00:00:00Z`); if (!Number.isNaN(t)) timeline.setRange(t, s.end); };
  const setEnd = (e) => { const t = Date.parse(`${e.target.value}T23:59:00Z`); if (!Number.isNaN(t)) timeline.setRange(s.start, t); };
  const step = (dir) => timeline.step(dir * STEPS[stepKey]);
  return (
    <footer className="timeline">
      <div className="transport">
        <button onClick={() => step(-1)} title="Step back" aria-label="Step back">⏮</button>
        <button onClick={() => { timeline.setDirection(-1); timeline.play(); }} className={s.playing && s.direction < 0 ? 'on' : ''} title="Play backward" aria-label="Play backward">◀</button>
        <button onClick={() => timeline.pause()} title="Pause" aria-label="Pause" className={!s.playing ? 'on' : ''}>⏸</button>
        <button onClick={() => { timeline.setDirection(1); timeline.play(); }} className={s.playing && s.direction > 0 ? 'on' : ''} title="Play forward" aria-label="Play forward">▶</button>
        <button onClick={() => step(1)} title="Step forward" aria-label="Step forward">⏭</button>
      </div>
      <div className="clock">
        <input type="date" value={dateStr(s.time)} min={dateStr(s.start)} max={dateStr(s.end)} onChange={setDate} aria-label="Date (UTC)" />
        <input type="time" value={timeStr(s.time)} onChange={setClock} aria-label="Time (UTC)" />
        <span className="utc">UTC</span>
        <button className="ghost" onClick={() => timeline.setTime(Date.now())} title="Jump to now">Now</button>
        <span className={`timeline-search-status ${acquisitionStatus?.loading ? 'searching' : ''}`} title={acquisitionStatus?.visible?.pinned ? 'Showing the dates from the search form. Move the timeline to follow it again.' : 'Footprints on the map are the scenes whose acquisition start falls inside the selected timeline window'}>
          <i />{acquisitionStatus?.loading ? 'SEARCHING ASF' : acquisitionStatus?.visible?.loaded ? (acquisitionStatus.visible.pinned ? `SEARCH RANGE · ${acquisitionStatus.visible.shown} SCENES` : `${acquisitionStatus.visible.shown} IN WINDOW · ${acquisitionStatus.visible.loaded} LOADED`) : 'AUTO ASF SYNC'}
        </span>
      </div>
      <label className="sel">Step
        <select value={stepKey} onChange={(e) => setStepKey(e.target.value)}>{Object.keys(STEPS).map((k) => <option key={k}>{k}</option>)}</select>
      </label>
      <label className="sel">Speed
        <select value={speedKey} onChange={(e) => { setSpeedKey(e.target.value); timeline.setSpeed(SPEEDS[e.target.value]); }}>{Object.keys(SPEEDS).map((k) => <option key={k}>{k}</option>)}</select>
      </label>
      <label className="sel">Show data from last
        <select value={s.windowMs} onChange={(e) => timeline.setWindow(Number(e.target.value))}>
          {[[3600e3, '1 hour'], [86400e3, '1 day'], [7 * 86400e3, '7 days'], [30 * 86400e3, '30 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="sel">Timeline range
        <select value="" onChange={(e) => { const d = Number(e.target.value); if (d) { const now = Date.now(); timeline.setRange(now - d * 86400e3, now); } }}>
          <option value="">{Math.round((s.end - s.start) / 86400e3)} days</option>
          {[[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year'], [4300, 'Since 2014']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="scrub">
        <input type="date" className="edge" value={dateStr(s.start)} max={dateStr(s.end)} onChange={setStart} aria-label="Range start (UTC)" />
        <input type="range" min={s.start} max={s.end} step={3600000} value={s.time} onChange={(e) => timeline.setTime(Number(e.target.value))} aria-label="Timeline" />
        <input type="date" className="edge" value={dateStr(s.end)} min={dateStr(s.start)} onChange={setEnd} aria-label="Range end (UTC)" />
      </div>
    </footer>
  );
}
