import { useState } from 'react'

const W = 460
const H = 210
const M = { l: 44, r: 12, t: 12, b: 26 }

const nice = (v, digits) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(digits))

// Lightweight SVG line chart. series: [{name, color, dash?, points:[[x,y],...]}]
export function LineChart({ series, xFormat, yUnit = '', digits = 1, xTitle }) {
  const [hover, setHover] = useState(null)
  const all = series.flatMap((s) => s.points.filter((p) => p[1] != null && Number.isFinite(p[1])))
  if (!all.length) return <div className="chart-empty">No data for this selection.</div>

  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  let y0 = Math.min(...ys), y1 = Math.max(...ys)
  if (y0 === y1) { y0 -= 1; y1 += 1 }
  const pad = (y1 - y0) * 0.1
  const nonNegative = y0 >= 0
  y0 -= pad; y1 += pad
  if (nonNegative && y0 < 0) y0 = 0
  const sx = (x) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r)
  const sy = (y) => H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b)

  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4)
  const xTicks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4)

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const x = x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0)
    if (x < x0 || x > x1) { setHover(null); return }
    const vals = series.map((s) => {
      let best = null
      s.points.forEach((p) => {
        if (p[1] == null) return
        if (!best || Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p
      })
      return best
    })
    setHover({ x: sx(x), vals, xv: x })
  }

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={M.l - 6} y={sy(t) + 3} className="tick" textAnchor="end">{nice(t, digits)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - 8} className="tick" textAnchor="middle">{xFormat(t)}</text>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2"
            strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round"
            points={s.points.filter((p) => p[1] != null).map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')} />
        ))}
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={M.t} y2={H - M.b} className="cross" />
            {hover.vals.map((v, i) => v && (
              <circle key={series[i].name} cx={sx(v[0])} cy={sy(v[1])} r="3.5" fill={series[i].color} />
            ))}
          </>
        )}
      </svg>
      {hover && (
        <div className="chart-tip">
          <div>{xFormat(hover.xv)}</div>
          {hover.vals.map((v, i) => v && (
            <div key={series[i].name}><i style={{ background: series[i].color }} />{series[i].name}: <b>{nice(v[1], digits)} {yUnit}</b></div>
          ))}
        </div>
      )}
      <div className="chart-legend">
        {series.map((s) => (<span key={s.name}><i style={{ background: s.color }} />{s.name}</span>))}
        {xTitle && <span className="chart-xtitle">{xTitle}</span>}
      </div>
    </div>
  )
}

// Horizontal diverging bars for before/after differences.
export function DeltaBars({ rows }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)))
  return (
    <div className="delta-bars">
      {rows.map((r) => (
        <div className="delta-row" key={r.label}>
          <span className="delta-label">{r.label}</span>
          <div className="delta-track">
            <div className="delta-fill" style={{
              width: `${(Math.abs(r.value) / max) * 50}%`,
              left: r.value >= 0 ? '50%' : `${50 - (Math.abs(r.value) / max) * 50}%`,
              background: r.color,
            }} />
          </div>
          <span className="delta-val">{r.value >= 0 ? '+' : ''}{r.value.toFixed(2)} km²</span>
        </div>
      ))}
    </div>
  )
}
