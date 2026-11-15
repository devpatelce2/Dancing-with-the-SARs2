// GeographicLayer — country boundaries (Natural Earth 50m) and labels (countries + oceans/seas).
// Boundaries are one PolylineCollection (cheap in 2D and 3D). Labels are zoom-gated by Natural Earth's own
// MIN_LABEL/MAX_LABEL ranks so the map stays readable at every scale.
import { Cesium } from '../MapEngine.js';
import { loadCountries, loadMarine } from '../../core/geo/geoData.js';

const C = Cesium.Color;
const EARTH_R = 6356752; // polar radius: slightly generous horizon, so nothing visible is hidden
const RAD = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (lon, lat) => { const f = lat * RAD, l = lon * RAD; return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)]; };
/** Spherical cap around a boundary ring: centre direction and angular radius (radians), used for horizon culling. */
export function ringCap(ring) {
  let x = 0, y = 0, z = 0; const us = ring.map(([lon, lat]) => unit(lon, lat));
  for (const u of us) { x += u[0]; y += u[1]; z += u[2]; }
  const m = Math.hypot(x, y, z); const c = m > 1e-9 ? [x / m, y / m, z / m] : us[0];
  let rad = 0; for (const u of us) rad = Math.max(rad, Math.acos(Math.min(1, Math.max(-1, dot(u, c)))));
  return { u: c, rad };
}
export class GeographicLayer {
  constructor(engine) {
    this.engine = engine; this.lines = new Cesium.PolylineCollection(); this.labels = new Cesium.LabelCollection({ scene: engine.scene });
    engine.scene.primitives.add(this.lines); engine.scene.primitives.add(this.labels);
    this.countryLabels = []; this.marineLabels = []; this.rings = []; this._off = null;
  }
  async init() {
    const [countries, marine] = await Promise.all([loadCountries(), loadMarine()]);
    const mat = Cesium.Material.fromType('Color', { color: C.fromCssColorString('#9fb4d4').withAlpha(0.55) });
    for (const f of countries.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) for (const ring of rings) {
        const line = this.lines.add({ positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()), width: 0.9, material: mat, id: `boundary:${f.id}` });
        this.rings.push({ line, ...ringCap(ring) });
      }
      const p = f.properties;
      if (p.labelX != null) this.countryLabels.push(this._label(p.name, p.labelX, p.labelY, p.minLabel ?? 3, p.maxLabel ?? 10, {
        fill: '#e8eefb', size: 13, italic: false }));
    }
    for (const f of marine.features) {
      const p = f.properties; if (!p.label) continue;
      this.marineLabels.push(this._label(p.name, p.label[0], p.label[1], p.minLabel ?? 1, p.maxLabel ?? 6, { fill: '#6fa8ff', size: 13, italic: true }));
    }
    this._off = this.engine.onCameraChange(() => this.refresh());
    this.engine.onMoveEnd(() => this.refresh());
    this._offMode = this.engine.onModeChange(() => this.refresh());
    this.refresh();
  }
  _label(text, lon, lat, minZ, maxZ, { fill, size, italic }) {
    const label = this.labels.add({
      text, position: Cesium.Cartesian3.fromDegrees(lon, lat),
      font: `${italic ? 'italic ' : ''}${size}px Inter, "Segoe UI", sans-serif`, fillColor: C.fromCssColorString(fill),
      outlineColor: C.fromCssColorString('#050a14'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER, show: false,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    return { label, minZ, maxZ, u: unit(lon, lat) };
  }
  refresh() {
    const z = this.engine.zoomLevel(); this._z = z;
    // On the globe, hide whatever is beyond the horizon ourselves: labels ignore depth by design, and this keeps the far side
    // of the Earth from showing through on any graphics driver.
    const globe = this.engine.mode === '3D'; let c = null; let cosH = -1; let hAng = Math.PI;
    if (globe) {
      const p = this.engine.viewer.camera.positionWC; const m = Math.hypot(p.x, p.y, p.z) || 1;
      c = [p.x / m, p.y / m, p.z / m]; cosH = Math.min(1, EARTH_R / m); hAng = Math.acos(cosH);
    }
    for (const { label, minZ, maxZ, u } of [...this.countryLabels, ...this.marineLabels]) {
      label.show = this._labelsOn !== false && z >= minZ + 0.2 && z <= maxZ + 4 && (!globe || dot(u, c) > cosH);
    }
    for (const r of this.rings) r.line.show = !globe || hAng + r.rad >= Math.PI || dot(r.u, c) > Math.cos(hAng + r.rad);
    this.engine.requestRender();
  }
  setLabelsVisible(v) { this._labelsOn = v; this.refresh(); }
  setBoundariesVisible(v) { this.lines.show = v; this.engine.requestRender(); }
  dispose() { this._off?.(); this._offMode?.(); this.engine.scene.primitives.remove(this.lines); this.engine.scene.primitives.remove(this.labels); }
}
