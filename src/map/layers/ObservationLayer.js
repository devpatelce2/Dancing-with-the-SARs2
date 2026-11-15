// ObservationLayer — renders vector footprints for ONE registry layer from the ObservationStore.
// Mission-agnostic: Sentinel-1, NISAR and every disaster type use this same class with a different layerId/color.
// Draws only what the store returns for the timeline window; with an empty store it draws nothing.
import { Cesium } from '../MapEngine.js';
import { featureCenter, inBounds } from '../../core/geo/bounds.js';
import { quakeClass, quakeSize } from '../../data/quakeScale.js';

export class ObservationLayer {
  constructor(engine, store, def) {
    this.engine = engine; this.store = store; this.def = def; this.visible = def.visible ?? false;
    this.color = Cesium.Color.fromCssColorString(def.color ?? '#ff7a59');
    this.fill = null; this.lines = null; this.points = null; this.rendered = 0; this._timer = null; this.window = null;
  }
  setVisible(v) { this.visible = v; this._schedule(); }
  setBounds(b) { this.bounds = b; this._schedule(); }
  setWindow(win) { this.window = win; this._schedule(); }
  refresh() { this._schedule(); }
  _schedule() { if (this._timer) return; this._timer = setTimeout(() => { this._timer = null; this._draw(); }, 150); } // throttle: draws keep happening during playback
  _remove(list) { for (const p of list) p && !p.isDestroyed?.() && this.engine.scene.primitives.remove(p); }
  _clear() { this._remove([this.fill, this.lines, this.points, this.halo]); this.fill = this.lines = this.points = this.halo = null; this.rendered = 0; }
  _draw() {
    const old = [this.fill, this.lines, this.points, this.halo]; // kept on screen until the new set is ready: no blank flicker
    this.fill = this.lines = this.points = this.halo = null; this.rendered = 0;
    if (this.visible) {
      let { features } = this.store.query({ layerId: this.def.id, window: this.window ?? undefined, limit: 5000 });
      if (this.bounds) features = features.filter((f) => inBounds(featureCenter(f), this.bounds));
      features = features.slice(0, 3000);
      const fills = []; const lines = new Cesium.PolylineCollection(); const pts = new Cesium.PointPrimitiveCollection();
      // Hazard layers (floods, quakes, fires...) are drawn bolder than SAR footprints so they stay visible when zoomed out:
      // opaque white-ringed markers with a soft halo, strongly filled polygons with a dark casing under a bright rim.
      const hazard = this.def.group === 'disaster';
      const rim = Cesium.Material.fromType('Color', { color: this.color.withAlpha(hazard ? 1 : 0.9) });
      const casing = hazard ? Cesium.Material.fromType('Color', { color: Cesium.Color.BLACK.withAlpha(0.55) }) : null;
      const fillAlpha = hazard ? 0.5 : 0.22;
      const halos = hazard ? new Cesium.PointPrimitiveCollection() : null;
      for (const f of features) {
        const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
        if (polys) {
          for (const rings of polys) {
            const outer = Cesium.Cartesian3.fromDegreesArray(rings[0].flat());
            fills.push(new Cesium.GeometryInstance({ id: f.id, geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(outer,
              rings.slice(1).map((h) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(h.flat())))), perPositionHeight: false, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
              attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.color.withAlpha(fillAlpha)) } }));
            const ringPos = Cesium.Cartesian3.fromDegreesArray(rings[0].flat());
            if (casing) lines.add({ positions: ringPos, width: 5, material: casing, id: f.id });
            lines.add({ positions: ringPos, width: hazard ? 2.5 : 1.2, material: rim, id: f.id });
          }
        } else if (g.type === 'Point') {
          const pos = Cesium.Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]);
          if (hazard) {
            // earthquakes: colour and size both follow magnitude (see data/quakeScale.js); other hazards keep the layer colour
            const mag = this.def.id === 'earthquakes' ? f.properties.metadata?.original?.mag : null; const qc = quakeClass(mag);
            const col = qc ? Cesium.Color.fromCssColorString(qc.color) : this.color;
            const size = qc ? quakeSize(mag) : Math.max(f.properties.metadata?.size ?? 10, 12);
            halos.add({ position: pos, color: col.withAlpha(qc ? 0.16 + 0.05 * qc.level : 0.28), pixelSize: size * (qc ? 1.55 + 0.12 * qc.level : 2.6), id: f.id });
            pts.add({ position: pos, color: col, pixelSize: size, outlineColor: qc && qc.level >= 4 ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#1b1020'), outlineWidth: qc && qc.level >= 4 ? 2.5 : 1.5, id: f.id });
          } else {
            pts.add({ position: pos, color: this.color, pixelSize: f.properties.metadata?.size ?? 8, outlineColor: Cesium.Color.BLACK, outlineWidth: 1, id: f.id });
          }
        }
        this.rendered++;
      }
      if (fills.length) this.fill = this.engine.scene.primitives.add(new Cesium.Primitive({ geometryInstances: fills, asynchronous: true,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }) }));
      this.halo = halos ? this.engine.scene.primitives.add(halos) : null; // added before the markers so it renders underneath
      this.lines = this.engine.scene.primitives.add(lines); this.points = this.engine.scene.primitives.add(pts);
    }
    if (this.fill && this.fill.readyEvent) {
      let done = false; const swap = () => { if (done) return; done = true; this._remove(old); this.engine.requestRender(); };
      this.fill.readyEvent.addEventListener(swap); setTimeout(swap, 1500);
    } else this._remove(old);
    this.engine.requestRender();
  }
  dispose() { clearTimeout(this._timer); this._clear(); }
}
