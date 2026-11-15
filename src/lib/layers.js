// Layer registry. To add a real dataset later (clouds, gases, fog, rain...):
//   1. find its entry in DATA_LAYERS in App.jsx (status: 'planned')
//   2. give it a `create(viewer)` function and set status: 'ready'
// `create` must return { setShow(bool), setOpacity?(0..1), destroy() }.
// For tile/WMTS data use imageryLayerFactory(...) below.
import * as Cesium from 'cesium'

export function imageryLayerFactory(providerOrFn, { alpha = 0.7 } = {}) {
  return (viewer) => {
    const provider = typeof providerOrFn === 'function' ? providerOrFn() : providerOrFn
    const layer = viewer.imageryLayers.addImageryProvider(provider)
    layer.alpha = alpha
    return {
      setShow(on) { layer.show = on },
      setOpacity(a) { layer.alpha = a },
      destroy() { viewer.imageryLayers.remove(layer, true) },
    }
  }
}

// Example for later (NASA GIBS, free, no key) — NOT enabled yet:
// create: imageryLayerFactory(() => new Cesium.WebMapTileServiceImageryProvider({
//   url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/<LAYER>/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png',
//   layer: '<LAYER>', style: 'default', format: 'image/png',
//   tileMatrixSetID: 'GoogleMapsCompatible_Level9', maximumLevel: 9,
//   tilingScheme: new Cesium.WebMercatorTilingScheme(),
// }))

export class LayerManager {
  constructor(viewer) {
    this.viewer = viewer
    this.defs = new Map()
    this.live = new Map()
    this.ui = new Map()
  }

  register(def) {
    this.defs.set(def.id, def)
    this.ui.set(def.id, { enabled: !!def.defaultOn, opacity: def.opacity ?? 0.7 })
    if (def.status === 'ready' && def.create) {
      const inst = def.create(this.viewer)
      this.live.set(def.id, inst)
      inst.setShow(this.ui.get(def.id).enabled)
    }
  }

  setEnabled(id, on) {
    this.ui.get(id).enabled = on
    this.live.get(id)?.setShow(on)
  }

  setOpacity(id, a) {
    this.ui.get(id).opacity = a
    this.live.get(id)?.setOpacity?.(a)
  }

  get(id) { return this.live.get(id) }

  list() {
    return [...this.defs.values()].map((d) => ({ ...d, ...this.ui.get(d.id) }))
  }

  destroy() {
    this.live.forEach((l) => l.destroy())
    this.live.clear()
  }
}

// Placeholder for the "highlight" feature (needs real datasets first).
// Call highlightRegion(viewer, {id, positions:[lon,lat,...], color}) later.
export function highlightRegion(viewer, { id, positions, color = '#ff5d73' }) {
  const c = Cesium.Color.fromCssColorString(color)
  return viewer.entities.add({
    id,
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
      material: c.withAlpha(0.22),
      outline: true,
      outlineColor: c,
      height: 0,
    },
  })
}
