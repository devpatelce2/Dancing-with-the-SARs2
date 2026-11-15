// SolarLightingLayer — day/night overlay. Rasterises solar elevation (core/solar) for the selected UTC time into a
// transparent equirectangular image and drapes it over the globe. Independent of satellite data and of the layer registry.
import { Cesium } from '../MapEngine.js';
import { solarPosition, illuminationRGBA, terminatorLine } from '../../core/solar/solar.js';

const W = 720, H = 360;
export class SolarLightingLayer {
  constructor(engine) {
    this.engine = engine; this.layer = null; this.line = null; this.visible = true; this.time = Date.now(); this._busy = false; this._pending = false;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H; this.ctx = this.canvas.getContext('2d');
    this.terminator = new Cesium.PolylineCollection(); engine.scene.primitives.add(this.terminator);
    this.lineMat = Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#ffd37a').withAlpha(0.55) });
    this.position = solarPosition(this.time);
  }
  getPosition() { return this.position; }
  setVisible(v) { this.visible = v; if (this.layer) this.layer.show = v; this.terminator.show = v; if (v) this.setTime(this.time); this.engine.requestRender(); }
  /** Coalesces rapid timeline updates (playback) so at most one raster/texture upload is in flight. */
  setTime(ms) {
    this.time = ms; this.position = solarPosition(ms);
    if (!this.visible) return;
    const t = performance.now();
    if (this._busy || t - (this._lastRender || 0) < 350) { this._pending = true; clearTimeout(this._tt); this._tt = setTimeout(() => { if (this._pending && !this._busy) { this._pending = false; this._lastRender = performance.now(); this._render(); } }, 350); return; }
    this._lastRender = t;
    this._render();
  }
  async _render() {
    this._busy = true;
    try {
      const pos = this.position;
      const img = new ImageData(illuminationRGBA(pos, W, H), W, H);
      this.ctx.putImageData(img, 0, 0);
      const provider = await Cesium.SingleTileImageryProvider.fromUrl(this.canvas.toDataURL('image/png'), { rectangle: Cesium.Rectangle.MAX_VALUE });
      const next = this.engine.viewer.imageryLayers.addImageryProvider(provider);
      next.show = this.visible;
      if (this.layer) this.engine.viewer.imageryLayers.remove(this.layer, true);
      this.layer = next;
      this.engine.rasters?.raiseAll(); // data overlays stay on top of the night shade
      // Update one persistent polyline in place. (removeAll() destroys the Material, so it must never be reused after.)
      const positions = Cesium.Cartesian3.fromDegreesArray(terminatorLine(pos, 2).flat());
      if (this.line) this.line.positions = positions;
      else this.line = this.terminator.add({ positions, width: 1.2, material: this.lineMat });
      this.engine.requestRender();
    } catch (e) { console.error('SolarLightingLayer render failed', e); }
    finally { this._busy = false; if (this._pending) { this._pending = false; this._render(); } }
  }
  dispose() { this.layer && this.engine.viewer.imageryLayers.remove(this.layer, true); this.engine.scene.primitives.remove(this.terminator); }
}
