// MapEngine — owns the Cesium Viewer and nothing mission-specific.
// Starts in SceneMode.SCENE2D (flat map). `setMode('3D')` morphs the same viewer, scene graph and layers to the globe,
// which is why every map layer is built from Cesium primitives/imagery layers (valid in 2D, Columbus view and 3D).
import * as Cesium from 'cesium';

const GLOBE_HOME_HEIGHT = 2.2e7; // metres: whole Earth disc in view
const GLOBE_MAX_HEIGHT = 4.5e7;

export class MapEngine {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.viewer = new Cesium.Viewer(container, {
      sceneMode: Cesium.SceneMode.SCENE2D,
      mapProjection: new Cesium.GeographicProjection(), // equirectangular: lon/lat map 1:1 to pixels, poles included
      baseLayer: false, // no Cesium ion dependency; BaseMapLayer supplies imagery
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      requestRenderMode: true, maximumRenderTimeChange: Infinity, // render only when something changes
      contextOptions: { webgl: { alpha: false } },
    });
    const { scene } = this.viewer;
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#07101f');
    scene.globe.enableLighting = false;           // illumination is our own SolarLightingLayer, not Cesium's lighting
    scene.skyAtmosphere && (scene.skyAtmosphere.show = false);
    scene.sun && (scene.sun.show = false); scene.moon && (scene.moon.show = false);
    scene.backgroundColor = Cesium.Color.fromCssColorString('#050a14');
    this.viewer.cesiumWidget.creditContainer.style.display = 'none'; // credits are shown in our own attribution bar
    this.homeRect = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90);
    this._clickHandlers = new Set();
    this._moveHandlers = new Set();
    this.handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e) => this._onClick(e.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e) => this._onMouseMove(e.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.mode = '2D';
    this._modeHandlers = new Set();
    this.resetView(0);
    this._limitZoom();
    this._max2D = scene.screenSpaceCameraController.maximumZoomDistance;
  }
  get scene() { return this.viewer.scene; }
  requestRender() { this.scene.requestRender(); }

  resetView(duration = 0.8) {
    const cam = this.viewer.camera;
    if (this.mode === '3D') { // whole Earth, keeping the longitude the user is looking at
      const lon = Cesium.Math.toDegrees(cam.positionCartographic.longitude);
      const destination = Cesium.Cartesian3.fromDegrees(Number.isFinite(lon) ? lon : 90, 15, GLOBE_HOME_HEIGHT);
      if (duration === 0) cam.setView({ destination }); else cam.flyTo({ destination, duration });
    } else if (duration === 0) cam.setView({ destination: this.homeRect }); else cam.flyTo({ destination: this.homeRect, duration });
    this.requestRender();
  }
  /** Fly to a [W,S,E,N] degree box. `insetRightPx` keeps the box centred in the part of the map NOT covered by a right-hand panel. */
  flyToBounds(b, { duration = 1.0, insetRightPx = 0 } = {}) {
    const cw = Math.max(1, this.scene.canvas.clientWidth), chh = Math.max(1, this.scene.canvas.clientHeight);
    const f = insetRightPx > 0 && cw - insetRightPx > 260 ? (cw - insetRightPx) / cw : 1;
    const sw = b[2] - b[0], sh = b[3] - b[1], cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const W = Math.min(360, Math.max(sw / (0.78 * f), (sh / 0.78) * (cw / chh)));
    const H = Math.min(178, W * (chh / cw));
    const west = cx - (f * W) / 2, south = Math.max(-89, cy - H / 2), north = Math.min(89, cy + H / 2);
    this.viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(Math.max(-180, west), south, Math.min(180, west + W), north), duration });
    return f; // fraction of the map width left free (used to place the compare divider)
  }
  _limitZoom() {
    // Cap zoom-out at the whole-world view; cap zoom-in near street level.
    const c = this.scene.screenSpaceCameraController;
    c.minimumZoomDistance = 300;
    c.maximumZoomDistance = this.viewer.camera.positionCartographic.height * 1.02;
  }
  zoom(factor) { // factor > 1 zooms in
    const cam = this.viewer.camera; const h = cam.positionCartographic.height;
    const target = Math.min(this.scene.screenSpaceCameraController.maximumZoomDistance, Math.max(300, h / factor));
    if (target < h) cam.zoomIn(h - target); else cam.zoomOut(target - h);
    this.requestRender();
  }
  /** Approximate web-map zoom level from the visible longitude span; used for label density. */
  zoomLevel() {
    const r = this.viewer.camera.computeViewRectangle(); if (!r) return 2;
    const widthDeg = Math.max(0.0001, Cesium.Math.toDegrees(r.east - r.west + (r.east < r.west ? 2 * Math.PI : 0)));
    return Math.log2(1440 / widthDeg);
  }
  onCameraChange(cb) { const rm = this.viewer.camera.changed.addEventListener(cb); this.viewer.camera.percentageChanged = 0.05; return rm; }
  onMoveEnd(cb) { return this.viewer.camera.moveEnd.addEventListener(cb); }
  onPostRender(cb) { return this.scene.postRender.addEventListener(cb); }

  onClick(cb) { this._clickHandlers.add(cb); return () => this._clickHandlers.delete(cb); }
  onMouseMove(cb) { this._moveHandlers.add(cb); return () => this._moveHandlers.delete(cb); }
  _onMouseMove(windowPos) {
    const cart = this.viewer.camera.pickEllipsoid(windowPos, this.scene.globe.ellipsoid);
    if (!cart) { for (const cb of this._moveHandlers) cb(undefined); return; }
    const c = Cesium.Cartographic.fromCartesian(cart);
    const lon = Cesium.Math.toDegrees(c.longitude), lat = Cesium.Math.toDegrees(c.latitude);
    for (const cb of this._moveHandlers) cb({ lon, lat, windowPos, pickedIds: this._pickIds(windowPos) });
  }
  /** String ids of every vector feature under the cursor (hazard events). Throttled: picking is the costly part of hover. */
  _pickIds(windowPos) {
    const now = performance.now();
    if (this._pickAt && now - this._pickAt < 50 && this._pickPos && Math.hypot(windowPos.x - this._pickPos.x, windowPos.y - this._pickPos.y) < 3) return this._pickIdsLast ?? [];
    this._pickAt = now; this._pickPos = { x: windowPos.x, y: windowPos.y };
    const ids = [];
    try { for (const p of this.scene.drillPick(windowPos, 8)) { const id = p?.id ?? p?.primitive?.id; if (typeof id === 'string' && !ids.includes(id)) ids.push(id); } } catch { /* picking can fail mid-morph */ }
    this._pickIdsLast = ids; return ids;
  }
  _onClick(windowPos) {
    const cart = this.viewer.camera.pickEllipsoid(windowPos, this.scene.globe.ellipsoid);
    if (!cart) return;
    const c = Cesium.Cartographic.fromCartesian(cart);
    let lon = Cesium.Math.toDegrees(c.longitude); const lat = Cesium.Math.toDegrees(c.latitude);
    lon = ((((lon + 180) % 360) + 360) % 360) - 180; // wrap when panned across the antimeridian
    const picked = this.scene.pick(windowPos);
    for (const cb of this._clickHandlers) cb({ lon, lat, windowPos, pickedId: picked?.id ?? picked?.primitive?.id ?? null });
  }
  /** Screen position of a lon/lat (null when off-screen). */
  toWindow(lon, lat) { return Cesium.SceneTransforms.worldToWindowCoordinates(this.scene, Cesium.Cartesian3.fromDegrees(lon, lat)) ?? null; }

  /** Centre of the current view in degrees plus camera height, or null when the view centre misses the Earth. */
  viewCentre() {
    const c = this.scene.canvas; const cam = this.viewer.camera;
    const cart = cam.pickEllipsoid(new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2), this.scene.globe.ellipsoid);
    if (!cart) return null;
    const g = Cesium.Cartographic.fromCartesian(cart);
    return { lon: Cesium.Math.toDegrees(g.longitude), lat: Cesium.Math.toDegrees(g.latitude), height: cam.positionCartographic.height };
  }
  onModeChange(cb) { this._modeHandlers.add(cb); return () => this._modeHandlers.delete(cb); }

  /** Switch between the flat map ('2D') and the globe ('3D'). Same viewer and layers; the place being looked at is kept. */
  setMode(mode) {
    mode = mode === '3D' ? '3D' : '2D';
    if (mode === this.mode || this._morphing) return this.mode;
    const before = this.viewCentre();
    const { scene } = this; const ctl = scene.screenSpaceCameraController;
    this._morphing = true; this.mode = mode;
    ctl.maximumZoomDistance = Number.POSITIVE_INFINITY; // limits are re-applied once the morph has finished
    const done = scene.morphComplete.addEventListener(() => {
      done(); this._morphing = false;
      const to3D = mode === '3D';
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = to3D;
      ctl.minimumZoomDistance = 300;
      ctl.maximumZoomDistance = to3D ? GLOBE_MAX_HEIGHT : this._max2D;
      const cam = this.viewer.camera;
      if (before) {
        // 2D height is the distance that frames the same ground width in 3D closely enough; clamp to each mode's limits
        const h = Math.min(to3D ? GLOBE_HOME_HEIGHT : this._max2D, Math.max(2000, before.height));
        cam.setView({ destination: Cesium.Cartesian3.fromDegrees(before.lon, to3D ? before.lat : Math.max(-85, Math.min(85, before.lat)), h) });
      } else this.resetView(0);
      this.requestRender();
      for (const cb of this._modeHandlers) cb(mode);
    });
    if (mode === '3D') scene.morphTo3D(0.8); else scene.morphTo2D(0.8);
    this.requestRender();
    return mode;
  }

  destroy() { this._modeHandlers.clear(); this._clickHandlers.clear(); this._moveHandlers.clear(); this.handler.destroy(); this.viewer.destroy(); }
}
export { Cesium };
