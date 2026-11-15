// RasterOverlayManager — georeferenced SAR rasters (PNG/JPEG now; COG-derived tiles later) as imagery layers.
// Built for before/after comparison: any overlay can be pinned left/right of a draggable split line.
// No rasters are bundled. Callers add real, processed overlays with their provenance.
import { Cesium } from '../MapEngine.js';

export class RasterOverlayManager {
  constructor(engine) { this.engine = engine; this.items = new Map(); }
  /** @param {{id:string,url:string,bounds:[number,number,number,number],timestamp:string,source:string,meta?:object}} r  bounds = [W,S,E,N] degrees */
  async add(r) {
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(r.url, { rectangle: Cesium.Rectangle.fromDegrees(...r.bounds) });
    const layer = this.engine.viewer.imageryLayers.addImageryProvider(provider);
    if (r.sampling === 'nearest') { // class maps (candidates, difference): show true pixels, not a blur between classes
      layer.magnificationFilter = Cesium.TextureMagnificationFilter.NEAREST; layer.minificationFilter = Cesium.TextureMinificationFilter.NEAREST;
    }
    this.items.set(r.id, { ...r, layer }); this.engine.requestRender();
    return layer;
  }
  /** Keep data overlays above map-wide layers (e.g. the day/night shade, which is re-added as time changes). */
  raiseAll() { for (const it of this.items.values()) this.engine.viewer.imageryLayers.raiseToTop(it.layer); if (this.items.size) this.engine.requestRender(); }
  remove(id) { const it = this.items.get(id); if (it) { this.engine.viewer.imageryLayers.remove(it.layer, true); this.items.delete(id); this.engine.requestRender(); } }
  setVisible(id, v) { const it = this.items.get(id); if (it) { it.layer.show = v; this.engine.requestRender(); } }
  setAlpha(id, a) { const it = this.items.get(id); if (it) { it.layer.alpha = a; this.engine.requestRender(); } }
  /** side: 'left' | 'right' | 'none' — before/after comparison */
  setSplit(id, side) {
    const it = this.items.get(id); if (!it) return;
    it.layer.splitDirection = { left: Cesium.SplitDirection.LEFT, right: Cesium.SplitDirection.RIGHT, none: Cesium.SplitDirection.NONE }[side];
    this.engine.requestRender();
  }
  setSplitPosition(frac) { this.engine.scene.splitPosition = Math.min(1, Math.max(0, frac)); this.engine.requestRender(); }
}
