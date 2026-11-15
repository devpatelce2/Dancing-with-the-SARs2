# Build log — milestone 1 (Global Earth Map Foundation)

| Step | What | Verification |
|---|---|---|
| 1 | Fresh Vite + React 19 + Cesium 1.147 project; Cesium assets copied by script (no extra plugin) | `npm run build` ✔ |
| 2 | Natural Earth 50m countries + 110m marine polygons, slimmed (stable `ADM0_A3` ids) | Counted: 242 countries, 29 marine, all marine labelled |
| 3 | `core/solar` NOAA algorithm | 12 unit tests ✔ (J2000, equinox/solstice, EoT extremes, zenith, polar night, 2014) |
| 4 | `TimelineController`, `LayerRegistry`, schema, ASF adapter, generic adapter, store, point-in-polygon | 11 unit tests ✔ (fake clock playback, clamping, paging, adapters) |
| 5 | Cesium 2D map: base, boundaries+labels, solar overlay, observation layer, raster/split manager | Build ✔; all 35 Cesium symbols used exist in installed package ✔ |
| 6 | UI: sidebar, timeline, popup, legend, controls, fullscreen | Build ✔ |
| 7 | Inventory script for existing datasets | Run on a throwaway dir only |

## Live ASF catalog integration (current update)
- Added the sidebar search for Sentinel-1 GRD_HD and NISAR GCOV catalog records, date range, current-view/global search, result cap and mission product-level selectors.
- Added Vite development proxy and Vercel serverless proxy for the public ASF Search API.
- Successful search results draw real acquisition footprints in separate Cesium data sources; mission visibility switches are connected to the existing registry.
- Unit tests: 24 passing, including ASF query defaults and WKT construction.
- Live ASF requests could not be verified in this execution environment because outbound DNS/network access is unavailable. Run `npm run verify:asf` on a connected machine.
- Full production build could not be completed here: the uploaded `node_modules` lacks the Linux Rolldown optional native binding. Reinstall dependencies on the target machine (`npm ci`) before `npm run build`.

## NOT verified
- **Nothing has been rendered in a browser.** No headless browser could be installed here. Expect first-run visual bugs
  (label density, popup placement, overlay seams, 2D picking). First action on your machine: `npm run dev` and check the list below.
- The live ASF adapter is based on documented ASF Search API property names; it has not yet been exercised against a real live response in this environment.
- No SAR scene pixels or backscatter rasters are bundled. The new live integration fetches catalog footprints/metadata only; actual raster imagery still needs a separate COG/tile source.
- Your existing datasets were not visible here; preservation tooling is untested against them.
- Resource documentation for the 13 supplied links is not part of this milestone's deliverables yet.
- Antimeridian-crossing footprints are not split.

## First-run checklist
1. Map loads at global view, poles visible, Antarctica present. 2. Boundaries/labels toggle; labels thin out when zoomed out.
3. Day/night toggle; shading moves when scrubbing; terminator passes through the subsolar longitude ±90°.
4. Play/pause advances time, stops at range end. 5. Click ocean + land + Antarctica → popup values correct.
6. Import a real Vertex GeoJSON → footprints appear only inside the time window.


## 2026-11-14 — Milestone 1 verification hardening

- Added the previously omitted `test/*.test.mjs` suite to `npm test`.
- Corrected the NISAR query expectation from RSLC to GCOV in the ASF test.
- Verified all 32 unit tests pass.
- Live ASF verification could not be completed in this execution environment because outbound DNS/network access is unavailable.
- Production build could not be completed because `npm ci` did not finish and Cesium was unavailable; retry on Node.js >=22.17.0 with network access.
- See `docs/IMPLEMENTATION_AUDIT.md` for acceptance checks and limitations.

## 2026-11-14 — Phase 1 + backend/pipeline (merged onto hardened Milestone 1)
- Demo/production switch (`VITE_DEMO_MODE`), site data contract validator (`src/lib/siteData.js`), empty `public/data/sites.json`.
- Python `pipeline/` (catalogue search, pair finder, HDF5 inspector) and FastAPI `backend/` (health, sites, metadata, change, catalogue search).
- Milestones 2-4: GCOV reader, change detection, exports, run_site CLI (synthetic-fixture tests only; not yet run on a real NISAR file).

## 2026-11-14 — Time series + dotted chart
- `pipeline/processing/timeseries.py`, `pipeline/run_timeseries.py`: stack of GCOV scenes -> per-date mean dB, baseline, changed area, z, Mann-Kendall, Sen slope, per-date overlays.
- `src/lib/timeSeries.js` (validator/loader/chart maths), `src/components/TimeSeriesPanel.jsx` (dotted SVG chart, stats, map overlay), mounted in `App.jsx`; `MapEngine.flyToBounds`.
- Tests: 8 Python (synthetic HDF5), 8 new JS. Panel rendered in headless Chrome with synthetic data (chart OK). Map overlay NOT visually verified (sandbox cannot load the online basemap).
- Still NOT verified: real NISAR HDF5 layout, real data end-to-end, overlay alignment on the map.

## 2026-11-14 — Real-file fixes + streaming
- Real GCOV (track 091, frame 076): frequencyA HHHH = 34056 x 34704 px. Reader now reads only the AOI window, block-averages (default 8x8), applies the `mask` layer, and errors clearly if the AOI is outside the scene. Confirmed on the real file: 1262 x 1280 px at 80 m, 100% valid, mean -7.08 dB.
- `remote.py` streaming (HTTP Range), `find_scenes.py`, `--files-from`; `earthdatacloud.nasa.gov` added to the host allow-list (the real ASF file host `nisar.asf.earthdatacloud.nasa.gov` was previously refused).
- Tests: 48 Python (local Range server), 45 JS.

## 2026-11-14 — Compare tab + UI pass
- Compare dates tab (A/B pickers, swap, map divider with drag/keyboard, radar image or candidates, A/B/B−A table); per-date grey radar PNGs with one common stretch; site auto-zoom centred in the free map area.
- Fixes: overlays could be missed if data loaded before the map was ready; async overlay race; overlays now stay above the day/night shade; ASF error pages no longer dump HTML into the sidebar; unstyled "Show observation intensity" toggle; page overflow on narrow screens; resources list in the sidebar.
- Verified in headless Chrome (software GL, stand-in basemap, SYNTHETIC demo data): time series, dot selection, Compare split, divider drag, same-date warning, collapse, 390 px width; no console errors. JS 48 tests, Python 55 tests.
- NOT verified: real multi-date NISAR series end-to-end, streaming from live NASA servers, the live Esri basemap, real touch devices.

## 2026-11-15 — Final pass: index, 3D, performance, validation tool, live check
- Site index: rebuilt from folders (Python + Node, atomic write), hooked into dev/build and every pipeline run. Four real sites listed: bangladesh, noto-peninsula, sunamganj, sylhet; all four pass the frontend validator.
- 3D globe: `MapEngine.setMode` keeps the view centre, restores zoom limits per mode, shows the atmosphere; `3D` button in the map controls; borders and labels beyond the horizon are hidden (they showed through the globe); map controls no longer sit under the results panel.
- Performance: difference map median 161 ms -> 10 ms and colouring 45 ms -> 4 ms per date on a 711 x 696 image (Node benchmark); lazy per-date build with identical output to the reference functions (tested); PNG encoding off the main thread; overlay swap without a blank frame; idle prefetch; site files fetched in parallel; class maps drawn with nearest-neighbour sampling.
- Validation: `pipeline.validate` now handles time-series sites (raster or GeoJSON reference, optional reference baseline so only new water is compared); result stored in timeseries.json and shown in the panel. Tested on synthetic rasters only.
- `pipeline.verify_live`: PASS/FAIL/SKIP for ASF health, NISAR and Sentinel-1 search, token, authenticated NISAR stream, geocoder, USGS, EONET, basemap.
- Verified here: JS 68 tests, Python 86 tests, production build; headless Chrome (software GL, stand-in basemap) on the four real datasets: 2D, 3D and back, compare in 3D, rapid date clicks, layer switching, site switching, collapse; no console errors.
- NOT verified here (no network): every live service (all FAIL offline in verify_live, as expected), real GPU frame rates, the real basemap in 3D. NOT done: validation of any site against real reference data.
- Data notes: Bangladesh peaks at 0.9 km2 of candidates (no flood signal in that box/baseline); Noto's largest candidate area (48.7 km2) is on 2023-12-18, before the 2024-01-01 earthquake, so it is not earthquake damage; Sunamganj mixes acquisition modes (QPDH and DHDH file names).

## 2026-11-15 — Story tab
- `src/content/stories.js` (haor story for sylhet and sunamganj, with numbered sources), `src/components/StoryTab.jsx` (season player that steps the map and chart through the dates, animated radar-pulse diagrams, chapters that slide in), `storyFindings()` computes the "What we saw" sentences from timeseries.json so the story cannot disagree with the charts.
- Motion respects `prefers-reduced-motion`; playback starts only when the user presses Play.
- Verified in headless Chrome on the real Sylhet site: tab appears only for sites with a story, playback visits all 5 dates, jump buttons work, no console errors. JS 69 tests.
- Background facts are from the listed web sources (checked 2026-11-15); the team should still read them before submitting.

## 2026-11-15 — Combined build
- Merged the two uploaded trees (flood-highlight zip and the git working folder). The git folder was the superset: Story tab, 3D globe, validation tool, live check, self-healing site index, hazard hover cards, plus the Nepal site. Secrets and caches (key.txt, .cache, node_modules, dist, .git) are not part of the delivered zip.
- Pipeline guard: two products of the same satellite pass are now counted once (`dedupe_acquisitions`); the bundled Nepal site was built before this guard and lists 2026-09-24 and 2026-11-11 twice, so it should be re-run.
- Verified: JS 71 tests, Python 87 tests, build, headless Chrome: 5 sites load, Story playback visits all dates, 3D and back, no console errors. Hazard hover cards could not be exercised (event feeds need network); their unit tests pass.

## 2026-11-15 — Case studies: earthquake, wildfire, landslide
- `src/content/stories.js`: three new stories with numbered web sources (Noto Peninsula earthquake 2024, Cottonwood Fire Utah 2026, Wayanad landslides 2024) next to the haor flood story; `CASE_STUDIES` lists one main case per kind of change.
- Panel: "Case studies" buttons (Flood, Earthquake, Wildfire, Landslide). With processed data a button opens that site's Story tab; without, the story opens alone, marked "No radar data has been processed for this place yet", with the exact `pipeline.quick` command. Once that command has run, charts and findings fill in by themselves (site ids `cottonwood-fire`, `wayanad`).
- New animated diagrams: living canopy, burnt forest, landslide scar, coastal uplift. `storyFindings` now says when the largest change is before the event date.
- Only Noto has processed data among the three new cases. Wildfire and landslide pages report no radar result. Their commands and boxes are NOT verified against live data (no network here).
- Verified: JS 73 tests, production build, headless Chrome: all four buttons, story-only mode, back link, chapter reveal, no page errors.

## 2026-11-15 — Final touch
- `pipeline/quick.py`: dedupe before scene selection, auto fallback to Sentinel-1 when NISAR has no pre-event baseline, HH/HV to VV/VH mapping, clear errors (3 new tests with fake catalogues).
- Earthquake strength: `src/data/quakeScale.js` (magnitude classes, marker size, Modified Mercalli labels), markers, hover card block, legend (4 tests).
- Stories: key-fact cards; validation box explains the scores; misleading "no data source connected" tooltip on live hazard layers fixed.
- Visual pass: bundled fonts via @fontsource, new tokens, panel/tabs/inputs/charts restyled.
- Verified here: JS 77 tests, Python 90 tests, clean production build, headless Chrome (fonts load, panel, story, compare, earthquake markers/legend/hover card with a TEST-ONLY stand-in feed), no console errors.
- NOT done, because this environment has no network: validation of Sylhet against a reference, processing of the Wayanad and Cottonwood sites, a live deployment test, any check of live services.

## Sliding panels and side-panel tabs (15 Nov 2026)

- Side panel is now four tabs (Explore, Satellites, Layers, About) instead of one long column. All four stay mounted, so a search or filter keeps its state when you switch.
- Every panel slides away: side panel (‹ button, "Menu" handle to bring it back), timeline (▾ tab, "Timeline" handle), results panel (› button, "Surface change" button). One map button hides or restores all three.
- The radar layer and the compare divider now stay on the map when the results panel is hidden.
- The layout is remembered in the browser (localStorage key `sar.panels`).
- Phone layout: fixed the map collapsing to zero height when the side panel is hidden.
- Checked in headless Chrome at 1500×900 and 400×800: tab switching, each panel in and out, clear-map, reload, no console errors. JS tests 77 pass; build clean.

## Timeline slider fix (15 Nov 2026)
- The timeline slider had shrunk to a short stub. Cause: the slide-away handle buttons used the class `edge`, which the timeline's start/end date boxes already use, so they picked up the handle's absolute positioning. Handles are now `pedge`. Slider measured at 913 px wide on desktop and full width on phones.
