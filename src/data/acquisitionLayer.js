import * as Cesium from 'cesium'
import { DATASETS } from './asf.js'
import { COVERAGE_CLASSES, coverageClass } from './acquisitionWindow.js'

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

/**
 * Density = how many acquisitions cover each point (a catalogue fact), drawn in four stepped classes.
 * Each footprint adds a fixed amount to a hidden count canvas, which is then read back pixel by pixel.
 * Nothing is blurred or smoothed, so a pixel's shade never suggests radar brightness.
 */
const STEP = 8 // red-channel units per overlapping footprint: counts up to 31 stay exact
function drawDensity(canvas, countCanvas, records, color) {
  const cc = countCanvas.getContext('2d', { willReadFrequently: true })
  cc.clearRect(0, 0, WIDTH, HEIGHT)
  cc.globalCompositeOperation = 'lighter'
  cc.fillStyle = `rgb(${STEP},0,0)`
  for (const record of records) if (record.ring?.length >= 4) drawWrappedPolygon(cc, record.ring, () => cc.fill())
  cc.globalCompositeOperation = 'source-over'
  const src = cc.getImageData(0, 0, WIDTH, HEIGHT)
  const out = canvas.getContext('2d')
  const img = out.createImageData(WIDTH, HEIGHT)
  const n = Number.parseInt(color.replace('#', ''), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const alphaByClass = new Map(COVERAGE_CLASSES.map((c) => [c, Math.round(c.alpha * 255)]))
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    const cls = coverageClass(Math.max(1, Math.round(src.data[i] / STEP)))
    img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = alphaByClass.get(cls)
  }
  out.putImageData(img, 0, 0)
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
