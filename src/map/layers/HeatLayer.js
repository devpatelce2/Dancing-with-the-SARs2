// HeatLayer — thermal overlay of the hazard events that pass the current filter (layer on, timeline window, selected area).
// Pure view of the ObservationStore: it draws nothing when there are no matching events. Also outlines the selected area.
import { Cesium } from '../MapEngine.js'
import { featureCenter, inBounds } from '../../core/geo/bounds.js'

const W = 1024
const RAMP = [[0, 0, 0, 0, 0], [0.12, 40, 70, 255, 120], [0.3, 0, 205, 255, 175], [0.5, 110, 255, 90, 205], [0.72, 255, 220, 0, 225], [1, 255, 45, 0, 240]]
function ramp(t) {
  for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) {
    const a = RAMP[i - 1], b = RAMP[i], k = (t - a[0]) / (b[0] - a[0] || 1)
    return [1, 2, 3, 4].map((j) => a[j] + (b[j] - a[j]) * k)
  }
  return RAMP[RAMP.length - 1].slice(1)
}

export class HeatLayer {
  constructor(engine, platform, layerIds) {
    this.engine = engine; this.platform = platform; this.ids = layerIds
    this.bounds = null; this.timer = null; this.subs = new Set(); this.stats = { count: 0, byLayer: {} }
    this.ds = new Cesium.CustomDataSource('hazard-heat'); engine.viewer.dataSources.add(this.ds)
    this.heat = this.ds.entities.add({ show: false, rectangle: { coordinates: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90), material: Cesium.Color.TRANSPARENT, height: 80 } })
    this.outline = this.ds.entities.add({ show: false, polyline: { positions: [], width: 2.5, material: Cesium.Color.fromCssColorString('#00e5ff') } })
    const go = () => this.schedule()
    this.unsubs = [platform.store.subscribe(go), platform.registry.subscribe(go), platform.timeline.subscribe(go)]
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn) }
  setArea(b) {
    this.bounds = b
    this.outline.show = !!b
    if (b) this.outline.polyline.positions = Cesium.Cartesian3.fromDegreesArray([b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3], b[0], b[1]])
    this.schedule(true)
  }
  schedule(now = false) {
    if (this.timer) { if (!now) return; clearTimeout(this.timer) }
    this.timer = setTimeout(() => { this.timer = null; this.draw() }, now ? 0 : 200)
  }
  collect() {
    const win = this.platform.timeline.getWindow(); const pts = []; const byLayer = {}
    for (const id of this.ids) {
      if (!this.platform.registry.get(id)?.visible) continue
      const { features } = this.platform.store.query({ layerId: id, window: win, limit: 5000 })
      for (const f of features) {
        const c = featureCenter(f); if (!c || !inBounds(c, this.bounds)) continue
        const mag = Number(f.properties.metadata?.original?.mag)
        pts.push({ lon: c[0], lat: c[1], w: id === 'earthquakes' && Number.isFinite(mag) ? Math.max(0.6, mag - 3.2) : 1 })
        byLayer[id] = (byLayer[id] || 0) + 1
      }
    }
    return { pts, byLayer }
  }
  draw() {
    const { pts, byLayer } = this.collect()
    this.stats = { count: pts.length, byLayer, hasArea: !!this.bounds }
    this.subs.forEach((fn) => fn(this.stats))
    if (!pts.length) { this.heat.show = false; this.engine.requestRender(); return }
    const b = this.bounds || [-180, -90, 180, 90]
    const dLon = b[2] - b[0], dLat = b[3] - b[1]
    const H = Math.max(128, Math.min(1024, Math.round(W * dLat / dLon)))
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d'); const r = Math.max(10, W * (this.bounds ? 0.07 : 0.012))
    for (const p of pts) {
      const x = ((p.lon - b[0]) / dLon) * W, y = ((b[3] - p.lat) / dLat) * H
      const a = Math.min(0.9, 0.3 * p.w)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
    }
    const img = ctx.getImageData(0, 0, W, H); const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const t = Math.min(1, (d[i + 3] / 255) * 1.35)
      if (t <= 0.01) { d[i + 3] = 0; continue }
      const c = ramp(t); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]
    }
    ctx.putImageData(img, 0, 0)
    this.heat.rectangle.coordinates = Cesium.Rectangle.fromDegrees(b[0], b[1], b[2], b[3])
    this.heat.rectangle.material = new Cesium.ImageMaterialProperty({ image: cv, transparent: true })
    this.heat.show = true; this.engine.requestRender()
  }
  dispose() { clearTimeout(this.timer); this.unsubs.forEach((u) => u()); this.engine.viewer.dataSources.remove(this.ds, true) }
}
