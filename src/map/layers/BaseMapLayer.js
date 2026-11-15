// BaseMapLayer — high-resolution satellite basemap.
// Esri World Imagery provides detailed zoom levels for the 2D map.
// Natural Earth II remains available as an offline fallback if the tile service is unreachable.
import { Cesium } from '../MapEngine.js';

export class BaseMapLayer {
  constructor(engine) {
    this.engine = engine;
    this.layer = null;
    this.provider = null;
  }

  async init() {
    try {
      this.provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        minimumLevel: 0,
        maximumLevel: 19,
        tileWidth: 256,
        tileHeight: 256,
        credit: new Cesium.Credit('Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'),
      });

      await this.provider.readyPromise;
      this.layer = this.engine.viewer.imageryLayers.addImageryProvider(this.provider, 0);
      this.layer.brightness = 1.0;
      this.layer.contrast = 1.05;
      this.layer.saturation = 1.0;
    } catch (error) {
      console.warn('High-resolution satellite basemap unavailable; using Natural Earth II fallback.', error);
      const url = Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII');
      const fallback = await Cesium.TileMapServiceImageryProvider.fromUrl(url);
      this.layer = this.engine.viewer.imageryLayers.addImageryProvider(fallback, 0);
      this.layer.brightness = 0.9;
      this.layer.saturation = 0.9;
    }

    this.engine.requestRender();
  }

  dispose() {
    if (this.layer) {
      this.engine.viewer.imageryLayers.remove(this.layer, true);
      this.layer = null;
    }
  }
}
