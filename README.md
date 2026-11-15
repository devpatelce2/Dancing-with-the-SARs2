# Dancing with the SARs — Global Earth Map Foundation
React 19 · Vite · CesiumJS (SceneMode.SCENE2D, 3D-ready).

```bash
npm install
npm run fetch:geo && npm run build:geo   # only if public/data/geo/*.min.json are missing
npm run dev        # copies Cesium assets, starts Vite
npm test           # solar, timeline, registry, schema, adapters, store, geometry
npm run build      # production build -> dist/
npm run inventory -- /path/to/old/data   # read-only scan of existing SAR downloads
```
See `docs/ARCHITECTURE.md`, `docs/DATA_PRESERVATION.md`, `docs/BUILD_LOG.md`.


## Live Sentinel-1 / NISAR catalog

The **Live SAR Catalog · ASF DAAC** panel searches the ASF Search API for real acquisition footprints and metadata. It does not download full SAR scenes or render backscatter pixels. The search is metadata-only; downloading products requires a free NASA Earthdata Login.

- In development, Vite proxies `/api/asf/*` to `https://api.daac.asf.alaska.edu`.
- On Vercel, `api/asf.js` (with the rewrite in `vercel.json`) provides the same-origin serverless proxy.
- Select Sentinel-1 (`GRD_HD`) and/or NISAR (`GCOV`), choose a date range and map extent, then click **Search live acquisitions**.
- Use **Show acquisition footprints** as a master visibility switch. The Sentinel-1 and NISAR layer toggles also control their respective footprints.
- `npm run verify:asf` checks ASF's health endpoint and tries a small recent search for each mission (requires internet access).

For an online deployment, import this project into Vercel with the project root set to the folder that contains `package.json`, `api/` and `vercel.json`. The serverless proxy is included in the `api/` directory. Other static hosts need an equivalent server-side proxy; do not expose Earthdata credentials in browser code.

Full raster/backscatter visualization is a separate next step: it needs analysis-ready raster assets (for example OPERA RTC-S1 COGs or processed NISAR GCOV layers) and a tile/COG imagery layer in Cesium.

## Surface change: time series + Compare dates (NISAR GCOV)

```bash
pip install -r requirements.txt
$env:EARTHDATA_TOKEN = "<token from your Earthdata profile>"        # PowerShell; never commit it
python -m pipeline.find_scenes --bbox 90.8 24.3 91.8 25.2 --start 2026-06-17 --track 91 --direction DESCENDING --frame 76 --out scenes.txt
python check_scene.py "<one link from scenes.txt>" 90.8 24.3 91.8 25.2     # streams only the box
python -m pipeline.run_timeseries --site-id sylhet --name "Sylhet" --event "Monsoon flood" --bbox 90.8 24.3 91.8 25.2 --pol HHHH --threshold-db -3 --event-date YYYY-MM-DD --files-from scenes.txt
npm run dev
```
- **Time series tab**: dotted chart of AOI mean backscatter and change-candidate area per date, baseline band, statistics; click a dot to draw that date's candidates on the map.
- **Compare dates tab**: pick date A and date B; drag the divider on the map (A left, B right) over the radar image or the candidates; table of A, B and B − A.
- `python -m pipeline.make_demo` writes a clearly labelled SYNTHETIC site to try the interface; `python -m pipeline.make_demo --remove` deletes it. Remove it before presenting results.
- Local `.h5` files also work: `--files data\*.h5`.

## Choose an area in the browser (no coordinates)
Type a place in **Area and event filter**, pick an area size and an event type, press **Apply filter**: the map flies there, only matching real events (USGS earthquakes, NASA EONET floods/wildfires/...) are shown inside the box, with a thermal overlay of where they cluster.
**Analyze NISAR surface change here** runs the real pipeline as a background job. It needs the backend in a second terminal:
```
$env:EARTHDATA_TOKEN = "<token>"
uvicorn backend.app.main:app --port 8000
```

## Merged build: what changed
This is the combined project. Everything from the original app is kept (place search, area/event filters, live USGS + NASA EONET hazards, thermal overlay, ASF catalogue, NISAR time series and compare, analysis backend). Added:
- **Events on the map** list in the sidebar: the events matching the current filter, largest first, each with a type icon, date, magnitude and depth. Click one to fly to it.
- **Event popups** now show the event title, date, magnitude, depth, source and a *details* link instead of an internal id.
- **Legend** lists each active hazard type with its event count (marker size = magnitude).
- `public/data/geo` (country and marine boundaries) is bundled, so `npm run fetch:geo` is not needed.

Quick start: `npm install && npm run dev` (open the printed URL). Optional analysis backend: `uvicorn backend.app.main:app --port 8000`.

## Difference map (seeing where it changed)
In **Compare dates**, choose **Difference map** (the default when per-date radar images exist). In **Time series**, pick *Difference vs baseline* next to "show on map".
- **Red**: pixels at least the threshold (default 3 dB) *darker* than the median of the baseline scenes: smooth open water, flooded bare ground.
- **Blue**: at least the threshold *brighter*: flooded crops or trees (double-bounce), wet soil, growing crops. The candidate method only detects decreases, so blue is how you see flooded vegetation.
- Faint colour is a small change; changes under 1 dB are left transparent. Rivers and lakes that are dark on every date are *not* coloured, which is what separates a flood from permanent water.
- It is computed in the browser from the per-date grey images the pipeline already writes (`src/lib/diffMap.js`), so existing sites work without re-processing. On the synthetic demo it reproduces the pipeline's candidate percentages exactly.
- It is evidence to inspect, not a confirmed flood map: crop growth, soil moisture and wind also change backscatter. Compare with news or flood-extent products before concluding.


## Sentinel-1 support (events before NISAR)
NISAR launched in July 2025, so it has no data for earlier events (for example the January 2024 Noto earthquake). The surface-change pipeline can therefore also use **Sentinel-1** through ASF's **OPERA RTC-S1** product: terrain-corrected gamma0 backscatter at 30 m, one file per burst, so it is analysis-ready like NISAR GCOV.

In the browser, **Area and event filter** has a **Satellite** menu: *Auto* (NISAR when it has scenes for your dates, otherwise Sentinel-1), *NISAR* or *Sentinel-1*. From the command line:
```bash
python -m pipeline.check_sentinel1 --place "Noto, Ishikawa, Japan" --start 2023-12-14 --end 2024-02-15 --probe   # run once to check the live service
python -m pipeline.quick --place "Noto, Ishikawa, Japan" --event "Noto earthquake" --start 2023-12-14 --end 2024-02-15 --event-date 2024-01-01 --threshold-db -3
```
How it works: bursts are about 20 km long, so a 22 km box needs 2 to 3 bursts from the same pass. The catalogue step groups bursts into passes, picks ONE track (same viewing geometry every date) and writes one pass per line of the scenes file (burst URLs separated by spaces). The reader mosaics them, applies the product's layover/shadow mask when present (and says so when it ignores it), and the same baseline, threshold, time-series and difference-map code as NISAR does the rest. Output is `mission: "SENTINEL-1"`, polarization `VV` by default.

Things to know:
- Burst files (about 10 to 40 MB each) are downloaded whole, once, into `./.cache/sentinel1` (change with `S1_CACHE_DIR`); a 6-date run of a 22 km box is a few hundred MB. NISAR files are still streamed.
- It needs `EARTHDATA_TOKEN`, like NISAR.
- C-band sees flooding under dense vegetation much less than L-band, and the method detects backscatter DECREASES only (open-water style). It does not measure earthquake damage or ground displacement; for an earthquake it can only flag change candidates such as new open water or landslide scars, to be checked against other evidence.
- The ASF product naming and the `_VV.tif` / `_mask.tif` file convention were written from documentation and tested on synthetic GeoTIFFs; there was no network in the authoring environment. `pipeline.check_sentinel1 --probe` confirms them against the live service in one minute.

## Final-pass additions (2026-11-15)

- **All processed sites are always listed.** `public/data/sites.json` is rebuilt from the site folders before `npm run dev` / `npm run build` and after every pipeline run (`npm run index:sites` or `python -m pipeline.rebuild_index` to do it by hand).
- **3D globe.** The `3D` button beside the zoom buttons switches between the flat map and the globe; the place in view is kept.
- **Faster pictures.** Difference maps are built only for the dates on screen (the rest fill in while idle); changing date swaps the picture without a blank frame.
- **Validation.** `python -m pipeline.validate --site-dir public/data/<id> --sar-date YYYY-MM-DD --reference <water map .tif or flood polygons .geojson> [--reference-baseline <same product, dry date>] --name "..." --source "..." --date YYYY-MM-DD` scores a date's candidates (precision, recall, F1, IoU) and the panel shows the result. Until that is run with a real reference, the panel says "Not validated yet".
- **Live check.** `python -m pipeline.verify_live --write docs/LIVE_CHECK.md` tests every online service the project uses and records PASS / FAIL / SKIP.
- **Secrets.** Keep the Earthdata token in the `EARTHDATA_TOKEN` environment variable only. Do not store it in a file inside the project.

## Final touch (2026-11-15)

- **Look and feel.** Bundled fonts (Space Grotesk for headings, IBM Plex Sans for text, IBM Plex Mono for values), one colour system, restyled panel, tabs, inputs and charts. No font CDN is used.
- **Earthquake strength.** Earthquake markers are sized and coloured by magnitude (Light, Moderate, Strong, Major, Great). The hover card shows magnitude, depth and, when USGS reports them, shaking intensity (Modified Mercalli), felt reports, the impact alert level and the tsunami flag. A magnitude legend appears when the layer has data. Intensity is never estimated by this app.
- **Case studies.** Four buttons (Flood, Earthquake, Wildfire, Landslide) with key-fact cards, animated diagrams and sourced text.
- **Scene selection fixes** in `pipeline.quick`: duplicate products of one pass no longer use up scene slots; if NISAR has fewer than two scenes before the event date, auto mode switches to Sentinel-1 (and maps HH/HV to VV/VH); clear errors when a baseline or enough dates are missing.
- **Validation.** The panel explains precision, recall, F1 and IoU. Scores appear only after `python -m pipeline.validate` has been run with a real reference map.

### Deploy checklist (run on a connected machine)
1. `npm ci && npm test && npm run build` (the build must finish without errors).
2. `python -m pipeline.verify_live --write docs/LIVE_CHECK.md` and read every FAIL line.
3. `npx vercel --prod` (the `api/` folder holds the ASF proxy function). Open the printed URL.
4. On the live URL check: the map loads with satellite imagery; the site list shows every site; Time series, Compare dates and Story open; the 3D button works; ticking Earthquakes loads events; "Search live acquisitions" returns footprints.

## Deploying the catalogue proxy (Sentinel-1 and NISAR search)

Locally, `npm run dev` proxies `/api/asf` to ASF DAAC. **GitHub Pages is static hosting: it has no `/api` route, so the search returns 404 there.** The app now tries, in order: `VITE_ASF_BASE`, same-origin `/api/asf`, then ASF directly (works only if ASF allows your origin via CORS). If none answers, the panel says so with the attempts it made.

- **Vercel:** deploy the repo as is. `api/asf.js` plus `vercel.json` provide `/api/asf/*` with CORS headers.
- **Cloudflare Worker:** paste `deploy/cloudflare-worker.js` into a Worker, then set `VITE_ASF_BASE=https://<your-worker>.workers.dev`.
- **GitHub Pages:** `.github/workflows/pages.yml` builds with the right sub-path. Add the repository variable `ASF_PROXY_URL` (Settings > Variables) pointing to your Vercel or Worker proxy.
- Check it: open `<proxy>/health` in a browser. If still failing, send the failing request URL and status from F12 > Network.

The proxy was tested here with mock responses only; this build environment cannot reach ASF.

## Radar image attribution
Every radar layer on the map has a "Radar image" card (bottom-left, top on phones) listing: what it shows, satellite and band, product and polarisation, acquisition time (UTC), track/frame/cycle, scene ID, processing settings, footprint, data credit and status (candidate, synthetic, or validated).

## Validating a flood case study
1. `python -m pipeline.find_reference --site-dir public/data/sylhet --sar-date 2026-07-14` lists independent OPERA DSWx water maps from NASA CMR (use `--product hls` for optical).
2. Download one with your Earthdata token, then run `python -m pipeline.validate ...` as printed.
3. Precision, recall, F1 and IoU then appear in the panel. Until you do this, the site says "not validated"; no score is invented. DSWx-S1 is radar too, so it is independent of our pipeline but not optical ground truth.
