import * as Cesium from 'cesium'
import { DATASETS } from './asf.js'

export const ACQ_PREFIX = 'acq:'
const WORLD_RECT = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
const WIDTH = 1536
const HEIGHT = 768
const boundsCache = new WeakMap()

/** One texture entity per mission and display mode: avoids thousands of Cesium billboards. */
export function createAcquisitionLayer(viewer, name = 'real-acquisitions') {
  const ds = new Cesium.CustomDataSource(name)
  const densityCanvas = document.createElement('canvas')
  densityCanvas.width = WIDTH; densityCanvas.height = HEIGHT
  const footprintCanvas = document.createElement('canvas')
  footprintCanvas.width = WIDTH; footprintCanvas.height = HEIGHT
  // Reuse one mask canvas per mission; avoids allocating a large temporary canvas on every refresh.
  const densityMaskCanvas = document.createElement('canvas')
  densityMaskCanvas.width = WIDTH; densityMaskCanvas.height = HEIGHT
  const densityEntity = ds.entities.add({
    id: `${ACQ_PREFIX}${name}:density`,
    rectangle: { coordinates: WORLD_RECT, material: new Cesium.ImageMaterialProperty({ image: densityCanvas, transparent: true }), height: 100, outline: false, outlineColor: Cesium.Color.TRANSPARENT },
    show: true,
  })
  const footprintEntity = ds.entities.add({
    id: `${ACQ_PREFIX}${name}:footprints`,
    rectangle: { coordinates: WORLD_RECT, material: new Cesium.ImageMaterialProperty({ image: footprintCanvas, transparent: true }), height: 110, outline: false, outlineColor: Cesium.Color.TRANSPARENT },
    show: false,
  })
  ds._densityCanvas = densityCanvas
  ds._footprintCanvas = footprintCanvas
  ds._densityMaskCanvas = densityMaskCanvas
  ds._densityEntity = densityEntity
  ds._footprintEntity = footprintEntity
  ds.setMode = (mode) => {
    densityEntity.show = mode === 'density'
    footprintEntity.show = mode === 'footprints'
  }
  viewer.dataSources.add(ds)
  return ds
}

function boundsFor(record) {
  if (boundsCache.has(record)) return boundsCache.get(record)
  const ring = record.ring || []
  const bounds = ring.length ? {
    west: Math.min(...ring.map(p => p[0])), east: Math.max(...ring.map(p => p[0])),
    south: Math.min(...ring.map(p => p[1])), north: Math.max(...ring.map(p => p[1])),
  } : null
  boundsCache.set(record, bounds)
  return bounds
}

function pointInRing(lon, lat, ring) {
  if (!ring?.length) return false
  const mean = ring.reduce((sum, p) => sum + p[0], 0) / ring.length
  while (lon - mean > 180) lon -= 360
  while (lon - mean < -180) lon += 360
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    const crosses = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)
    if (crosses) inside = !inside
  }
  return inside
}

function makePath(ctx, ring, offset = 0) {
  if (!ring || ring.length < 4) return
  ring.forEach(([lon, lat], index) => {
    const x = ((lon + 180) / 360) * WIDTH + offset
    const y = ((90 - lat) / 180) * HEIGHT
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

function drawWrappedPolygon(ctx, ring, draw) {
  // Duplicate at either edge so antimeridian-crossing scenes wrap correctly.
  for (const offset of [-WIDTH, 0, WIDTH]) {
    ctx.beginPath(); makePath(ctx, ring, offset); draw()
  }
}

function rgba(hex, alpha) {
  const value = hex.replace('#', '')
  const n = Number.parseInt(value, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function drawFootprints(canvas, records, color) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  ctx.lineWidth = 1.15
  ctx.strokeStyle = rgba(color, 0.92)
  ctx.fillStyle = rgba(color, 0.10)
  for (const record of records) {
    const ring = record.ring
    drawWrappedPolygon(ctx, ring, () => { ctx.fill(); ctx.stroke() })
  }
}

function drawDensity(canvas, maskCanvas, records, color) {
  const mask = maskCanvas.getContext('2d')
  const out = canvas.getContext('2d')
  mask.clearRect(0, 0, WIDTH, HEIGHT)
  out.clearRect(0, 0, WIDTH, HEIGHT)

  // Build a transparent observation mask. Additive compositing makes genuinely
  // overlapping acquisitions brighter without drawing a full-world colour tile.
  mask.globalCompositeOperation = 'lighter'
  mask.fillStyle = 'rgba(255,255,255,0.34)'
  for (const record of records) {
    if (record.ring?.length >= 4) drawWrappedPolygon(mask, record.ring, () => mask.fill())
  }
  mask.globalCompositeOperation = 'source-over'

  // Blur only the mask, then tint it. Pixels outside footprints remain fully transparent,
  // so the world-sized Cesium rectangle has no visible rectangular background or border.
  const glow = document.createElement('canvas')
  glow.width = WIDTH; glow.height = HEIGHT
  const glowCtx = glow.getContext('2d')
  glowCtx.filter = 'blur(16px)'
  glowCtx.drawImage(maskCanvas, 0, 0)
  glowCtx.filter = 'none'
  glowCtx.globalCompositeOperation = 'source-in'
  glowCtx.fillStyle = color
  glowCtx.fillRect(0, 0, WIDTH, HEIGHT)
  glowCtx.globalCompositeOperation = 'source-over'

  out.drawImage(glow, 0, 0)
  // Add a brighter, still feathered interior so density remains visible at normal zoom.
  out.globalCompositeOperation = 'lighter'
  out.globalAlpha = 0.58
  out.drawImage(maskCanvas, 0, 0)
  out.globalAlpha = 1
  out.globalCompositeOperation = 'source-over'
}

export function renderRecords(ds, records) {
  const list = records || []
  const color = DATASETS[list[0]?.dataset]?.color ?? '#ffffff'
  drawFootprints(ds._footprintCanvas, list, color)
  drawDensity(ds._densityCanvas, ds._densityMaskCanvas, list, color)
  // Reassign image values so Cesium notices the canvas texture update.
  ds._densityEntity.rectangle.material = new Cesium.ImageMaterialProperty({ image: ds._densityCanvas, transparent: true })
  ds._footprintEntity.rectangle.material = new Cesium.ImageMaterialProperty({ image: ds._footprintCanvas, transparent: true })
}

export function findHoveredAcquisitions(recordsByDataset, lon, lat) {
  const matches = []
  for (const records of Object.values(recordsByDataset || {})) {
    for (const record of records || []) {
      const b = boundsFor(record)
      if (!b || lat < b.south || lat > b.north) continue
      let testLon = lon
      while (testLon - (b.west + b.east) / 2 > 180) testLon -= 360
      while (testLon - (b.west + b.east) / 2 < -180) testLon += 360
      if (testLon < b.west || testLon > b.east) continue
      if (pointInRing(lon, lat, record.ring || [])) matches.push(record)
    }
  }
  return matches
}

/** Current camera view as a lon/lat box in degrees, or null when the whole globe is visible / undefined. */
export function viewBoxDegrees(viewer) {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
  if (!rect) return null
  const d = Cesium.Math.toDegrees
  return { west: d(rect.west), south: d(rect.south), east: d(rect.east), north: d(rect.north) }
}
