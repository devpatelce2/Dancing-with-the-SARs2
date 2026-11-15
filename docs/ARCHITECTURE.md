# Architecture — Global Earth Map Foundation

## Decision
**CesiumJS in `SceneMode.SCENE2D`, fresh project, no second mapping library.**
Reasons: (1) the same viewer morphs to 3D (`MapEngine.setMode('3D')`) with every layer intact, which a 2D-only
library cannot offer; (2) imagery layers, primitives and labels are valid in 2D, Columbus view and 3D; (3) equirectangular
`GeographicProjection` maps lon/lat linearly, including poles — Web Mercator would clip at ±85°.
Tradeoff: bundle size (~1.2 MB gzip) and Cesium's 2D label/picking quirks; mitigated by `requestRenderMode`.

## Dependency direction (strict)
```
 UI (React)  ─────────►  platform.js (composition root)  ◄─────────  map/ (Cesium)
                              │
        core/ — framework-free, no Cesium, no React:
        solar/  time/  layers/  data/ (schema, adapters, store)  geo/  inspector/
```
`core/` never imports from `map/` or `ui/`. The map reads `registry`, `timeline`, `store`; adapters write into `store`.

| Concept | File | Responsibility |
|---|---|---|
| MapEngine | `map/MapEngine.js` | Cesium viewer (2D), camera, click picking, 3D morph hook |
| BaseMapLayer | `map/layers/BaseMapLayer.js` | Background imagery (Natural Earth II, offline) |
| GeographicLayer | `map/layers/GeographicLayer.js` | Country boundaries + zoom-gated country/ocean labels |
| SolarLightingLayer | `map/layers/SolarLightingLayer.js` | Day/night raster + terminator line from `core/solar` |
| ObservationLayer | `map/layers/ObservationLayer.js` | Vector footprints/points for any registry layer (mission-agnostic) |
| RasterOverlayManager | `map/layers/RasterOverlayManager.js` | Georeferenced SAR rasters, opacity, left/right split for before/after |
| LayerRegistry | `core/layers/layerRegistry.js` | Layer metadata, visibility, status (`integrated`/`test`/`future`) |
| TimelineController | `core/time/timeController.js` | UTC time, range, playback, trailing data window |
| LocationInspector | `core/inspector/locationInspector.js` | Point → country/region/water + observations in window |
| Data adapters | `core/data/adapters/*` | Source records → normalized Observation |
| ObservationStore | `core/data/observationStore.js` | Windowed/paged queries; swap for remote provider later |

## Data flow
`Timeline → (sun.setTime, obs.setWindow)`; `Registry → (visibility)`; `Adapter → Store → ObservationLayer.refresh`;
`Map click → Inspector.inspect(lon,lat) → popup`. The timeline only exposes `getWindow()`; it knows nothing about datasets.

## Geographic data
Natural Earth 1:50m admin-0 countries (242 features, ~1.7 MB min JSON) + 1:110m marine polygons. Stable id is `ADM0_A3`
(**not** `ISO_A3`, which is `-99` for France, Norway, Kosovo and others in Natural Earth). `iso2` is kept when valid.
Antarctica, Arctic islands and Pacific islands are included. Regenerate: `npm run fetch:geo && npm run build:geo`.
Basemap raster: Cesium's bundled Natural Earth II tiles (offline). Click inspection resolves country via point-in-polygon on the 50m set;
ocean/sea names from the 110m marine set (coarse — a point can be near coast yet report no water body).

## Day/night
`core/solar/solar.js` implements the NOAA/Meeus algorithm (declination, equation of time → subsolar point), UTC-only.
Shading rasterises per-pixel solar elevation into a 720×360 equirectangular image: transparent for elevation ≥ 0°, ramping through
civil/nautical/astronomical twilight (to −18°). A 0° terminator line is drawn analytically. Unit-tested against J2000.0, equinox/solstice
declinations, equation-of-time extremes, zenith at the subsolar point, polar night/day, and a 2014 date.
Limits: no atmospheric refraction/oblateness; ~0.01° declination accuracy.

## Timeline
UTC throughout. State: `time`, `[start,end]` range (default 2014-04-03 → now; Sentinel-1A launch), `windowMs` (data shown = trailing
window ending at `time`), `speedMsPerSec`, `direction`. Playback uses `requestAnimationFrame` with dt clamping, stops at range ends.
Time-aware layers call `timeline.getWindow()`; `ObservationStore.query({window})` does the filtering (half-open overlap).

## Layer status semantics
`integrated` = backed by verified source data · `test` = user-supplied/unverified (set automatically on import) · `future` = registered, toggle works, **never draws data**.
The live ASF Search API integration marks Sentinel-1/NISAR `integrated` after a successful catalog response; the disaster-event layers remain `future` until their sources are connected.

## Normalized schema (see `core/data/schema.js`)
GeoJSON Feature, `id = "${source|mission}:${productId}"`, properties: `layerId, kind, category, mission, platform, productId, productType,
timestamp (ISO-8601 UTC), endTimestamp, orbitDirection, polarization, source, verificationStatus, metadata{…, original}`.
`metadata.original` keeps the untouched source record. Validated on `store.add`.

## Scaling plan (not yet built)
The store interface is query-shaped (`window`, `limit`, `offset`) so a remote provider can add bbox filtering, server paging, clustering
(`Cesium.EntityCluster`/supercluster) and aggregation without UI changes. Rendering currently caps at 3000 footprints per layer.
Footprints crossing the antimeridian need splitting before render (not handled yet).

## Adding things
- **New mission:** add an adapter (`canHandle`, `normalize`) in `core/data/adapters/`, register it in `platform.js` `ADAPTERS`, add a layer def to `DEFAULT_LAYERS`.
- **New disaster dataset:** use `genericGeoJsonAdapter({layerId, idProp, timeProp, source, verification})` or a bespoke adapter, `store.add(layerId, obs)`, then `registry.setStatus(layerId, 'integrated')` once verified.
- **SAR raster / before-after:** `engine.rasters.add({id,url,bounds,timestamp,source})`, `setSplit(idBefore,'left')`, `setSplit(idAfter,'right')`, `setSplitPosition(0.5)`.


## Live ASF catalog integration

The sidebar acquisition panel calls the ASF Search API through a same-origin proxy (`/api/asf`). Vite provides the development proxy; Vercel deployments use `api/asf/[...path].js`. The API returns GeoJSON catalog metadata, which `src/data/asf.js` validates and normalizes before `src/data/acquisitionLayer.js` draws the true scene footprints in separate Sentinel-1 and NISAR Cesium data sources. Registry visibility controls each mission independently. This is acquisition geometry only, not a raster backscatter visualization or a bulk data download.
