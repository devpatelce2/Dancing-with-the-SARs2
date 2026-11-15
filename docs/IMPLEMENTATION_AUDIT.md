# Milestone 1 implementation audit

## Scope
ASF DAAC catalogue discovery and acquisition metadata integration for Sentinel-1 and NISAR. This milestone does not download radar products or process pixels.

## Implemented in this repository
- ASF Search API client in `src/data/asf.js`.
- NISAR dataset configuration with GCOV as the default processing level.
- AOI bounding-box query construction, date filters, result caps, count query, GeoJSON normalization, footprint handling, deduplication and provenance.
- Vite development proxy and Vercel API proxy are configured in the repository.
- Acquisition panel integration is present in `src/components/AcquisitionPanel.jsx`.
- Live verification script: `scripts/verify-asf.mjs`.

## Verification performed in this environment
- Unit tests: 32 passed, 0 failed after including the previously omitted `test/asf.test.mjs` suite in `npm test`.
- Live ASF verification: NOT VERIFIED. Outbound DNS/network access was unavailable in this environment (`Could not resolve host: api.daac.asf.alaska.edu`).
- Production build: BLOCKED because the dependency installation did not complete and Cesium was unavailable (`cesium not installed`). Run `npm ci` on a network-enabled machine with Node.js >=22.17.0, then `npm run build`.

## Remaining acceptance checks
1. Run `npm run verify:asf` on a network-enabled machine.
2. Confirm the output includes at least one actual NISAR GCOV granule (or records a valid zero-result response for the selected time window/AOI).
3. Inspect the browser acquisition panel and confirm returned granules/footprints are displayed.
4. Run `npm ci`, `npm test`, and `npm run build` on Node.js >=22.17.0.

## Explicit non-goals
No Earthdata authenticated product download, GCOV HDF5 pixel reading, flood classification, displacement estimation or raster overlay output is implemented in Milestone 1.

---

# Additional findings (repository audit, later phase)
## Correct picture of the existing app
- React 19 + Vite 8 + CesiumJS 1.147. **No Resium**; the map is a custom engine (`src/map/MapEngine.js`) in **SceneMode.SCENE2D**
  ("3D-ready"). There is no 3D globe today.
- Working: 2D map, boundaries/labels, solar day/night overlay, timeline controller, layer registry, location inspector
  popup, ASF catalogue search (Sentinel-1 `GRD_HD`, NISAR `GCOV` default) with footprints, same-origin ASF proxy
  (Vite dev + `api/asf/[...path].js`, GET-only, allow-listed paths, 25 s timeout).
- Not present in this ZIP: **satellite orbit/TLE tracking and weather are not wired into the app** (`src/lib/orbits.js` and
  `src/lib/weather.js` exist but nothing imports them; only `Analysis.jsx`, itself unmounted, would use weather). Also absent:
  Resium, any Python, any raster/GeoTIFF data. These look like parts of an earlier version that were not carried into this ZIP.

## Synthetic-data dependencies
- `src/lib/trialData.js` (hash-based synthetic generator) <- `src/lib/dataProvider.js` <- `src/components/Analysis.jsx`
  and `src/lib/changeLayer.js`.
- `Analysis.jsx` and `Charts.jsx` are **not imported anywhere**; `ChangeLayer` is not instantiated. So the running app does not
  display synthetic values. Phase 1 nevertheless gates `Analysis` behind `VITE_DEMO_MODE=true`.

## Raster / GeoJSON loading
- `RasterOverlayManager` can add georeferenced single-tile imagery with split direction; nothing calls it with data yet.
- Observation footprints use `acquisitionLayer.js` CustomDataSource entities.

## Deployment constraints
- Vercel serves the static frontend plus a metadata-only ASF proxy. Multi-GB HDF5 + GDAL work cannot run in a serverless function.
- Raw granules and credentials are git-ignored.

## Verification status at this milestone
- JS: 29 tests pass, production build succeeds. Python: 14 tests pass (synthetic structures only).
- **Not verified (no network/credentials in the authoring sandbox):** any live ASF NISAR response, NISAR field names beyond those
  the existing client already reads, GCOV HDF5 internal layout, authenticated download.
