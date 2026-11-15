// Draws "changed areas" on the globe for the timeline moment, relative to a
// baseline moment. Data comes from src/lib/dataProvider.js.
import * as Cesium from 'cesium'
import { provider } from './dataProvider.js'

const KM = 1000

export class ChangeLayer {
  constructor(viewer) {
    this.viewer = viewer
    this.entities = []
    this.place = null
    this.radiusKm = 10
    this.baseline = Date.now()
    this.show = true
    this.lastKey = ''
    this.patches = []
  }

  setArea(place, radiusKm) {
    this.place = place
    this.radiusKm = radiusKm
    this.patches = place ? provider.changePatches(place, radiusKm) : []
    this.lastKey = ''
    if (!place) this.clear()
  }

  setBaseline(ms) { this.baseline = ms; this.lastKey = '' }
  setShow(on) { this.show = on; this.lastKey = ''; if (!on) this.clear() }

  clear() {
    this.entities.forEach((e) => this.viewer.entities.remove(e))
    this.entities = []
  }

  // Rebuild only when something visible actually changed.
  update(ms) {
    if (!this.place || !this.show) return
    const frames = this.patches.map((p) => {
      const d = Math.abs(provider.patchProgress(p, ms) - provider.patchProgress(p, this.baseline))
      return Math.round(d * 20) / 20
    })
    const key = `${this.place.lat},${this.place.lon},${this.radiusKm},${frames.join(',')}`
    if (key === this.lastKey) return
    this.lastKey = key
    this.clear()

    const { lat, lon } = this.place
    const mPerDegLat = 111320
    const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180)
    const add = (e) => this.entities.push(this.viewer.entities.add(e))

    // analysis-area boundary
    add({
      id: 'change-area',
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMajorAxis: this.radiusKm * KM, semiMinorAxis: this.radiusKm * KM,
        material: Cesium.Color.TRANSPARENT, outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.55),
        outlineWidth: 2, height: 0,
      },
    })

    this.patches.forEach((p, i) => {
      const delta = frames[i]
      if (delta < 0.08) return
      const cx = lon + (p.dxKm * KM) / mPerDegLon
      const cy = lat + (p.dyKm * KM) / mPerDegLat
      const scale = Math.sqrt(delta)
      const color = Cesium.Color.fromCssColorString(provider.patchTypes[p.type].color)
      add({
        id: `change-${p.id}`,
        name: provider.patchTypes[p.type].label,
        position: Cesium.Cartesian3.fromDegrees(cx, cy),
        ellipse: {
          semiMajorAxis: Math.max(150, p.rKm * KM * scale),
          semiMinorAxis: Math.max(100, p.rKm * KM * scale * p.aspect),
          rotation: p.rot,
          material: color.withAlpha(0.18 + 0.4 * delta),
          outline: true, outlineColor: color, outlineWidth: 2, height: 0,
        },
      })
    })
  }

  destroy() { this.clear() }
}
