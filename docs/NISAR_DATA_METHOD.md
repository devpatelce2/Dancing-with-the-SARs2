# NISAR flood-candidate method (Milestones 2-4)

## Pipeline
catalogue search -> candidate pair (metadata only) -> authenticated download (`pipeline.nisar.download`) -> GCOV read
(`gcov_reader`) -> AOI crop -> grid alignment -> optional exclusion masks -> speckle averaging (linear) -> dB log-ratio ->
threshold -> minimum mapping unit -> polygons + equal-area km² -> GeoTIFF / PNG / GeoJSON / meta.json -> optional validation.

## Assumptions (stated, not hidden)
- Input is NISAR L2 GCOV terrain-corrected backscatter in linear power; used as stored, no extra calibration.
- Open-water flooding lowers co-pol backscatter. Only **decreases** are detected; flooded vegetation (increase) is missed.
- The threshold has no default and no universal value. Record how it was chosen (site histogram, reference, literature).
- Output pixels are **flood candidates**, never "confirmed flood". Not displacement.

## Not yet verified
- GCOV HDF5 dataset names/attributes against a real granule (run `python -m pipeline.nisar.hdf5_inspect <file>`).
- Live ASF catalogue response, authenticated download.
- Any accuracy: `meta.validation` is `null` until `python -m pipeline.validate` is run with a documented independent reference.

## Masks
`--exclude-mask file.tif` (repeatable): non-zero pixels are excluded (permanent water, steep slope). Mask files are
user-supplied; the pipeline does not download a water or DEM product on its own.

## Time series (run_timeseries)
`python -m pipeline.run_timeseries --site-id <id> --event "<name>" --bbox W S E N --pol HHHH --threshold-db -3 --event-date YYYY-MM-DD --files data/*.h5`
- Inputs: >= 3 (ideally 8-10) GCOV scenes of ONE track / direction / frame / polarization. Mixed track/direction/frame is rejected.
- Per scene: crop AOI -> boxcar speckle averaging in linear power -> dB. AOI mean = mean of linear power, then dB.
- Baseline = scenes BEFORE `--event-date` (or the first `--baseline-n` scenes). Per-pixel baseline = median dB of baseline scenes.
- Candidate pixel = scene dB minus baseline dB <= threshold (negative), minimum mapping unit applied. Area = pixels x pixel area (equal-area EPSG:6933, AOI centre).
- z-score only with >= 3 baseline scenes. Mann-Kendall and Sen slope need >= 4 scenes. Neither proves a physical cause.
- AOI-mean dB dilutes local change (an 8 dB drop over 8% of the AOI moves the mean by ~0.4 dB); read it together with changed area.
- Output: `public/data/<site>/timeseries.json` + `ts/<time>.png` overlays; shown by `TimeSeriesPanel`.
- Verified only on SYNTHETIC HDF5 in the assumed layout (pipeline/tests/test_timeseries.py). Not yet run on a real NISAR granule.

### Real-file facts (from a downloaded L-band GCOV, track 091 frame 076)
- `science/LSAR/GCOV/grids/frequencyA/{HHHH,HVHV}` float32, _FillValue NaN, 34056 x 34704 px (~4.7 GB per layer in memory); `frequencyB` (5 MHz) is a coarse 4257 x 4338 grid.
- `mask` (uint8): 0 = partially focused/invalid, 255 = outside acquisition, otherwise sub-swath number. The reader excludes 0 and 255.
- Because of the size the reader reads ONLY the AOI window and averages `--downsample` x `--downsample` blocks (default 8) of linear power.
- `--frequency` defaults to `frequencyA` in run_timeseries (both frequencies carry HHHH, so it must be explicit; the choice is recorded).
- Open-water HV can approach the noise floor (noise-equivalent backscatter is about -26 dB in this file); HHHH is the better flood layer.

## Streaming instead of downloading (pipeline/nisar/remote.py, pipeline/find_scenes.py)
- `--files` / `--files-from` accept https URLs. h5py reads the granule through HTTP Range requests, so only the chunks inside your AOI are transferred (each scene's `notes` records "streamed X MB in N requests").
- Auth: `EARTHDATA_TOKEN` (Earthdata profile -> Generate Token). Never commit it. https only; host allow-list (asf.alaska.edu, earthdata.nasa.gov, earthdatacloud.nasa.gov); the token is dropped on redirects to other hosts.
- `python -m pipeline.find_scenes --bbox W S E N --start YYYY-MM-DD --pick-largest --out scenes.txt` lists GCOV scenes (metadata only) and writes the links for ONE track/direction/frame group.
- Verified only against a local Range server. Not verified against live ASF/Earthdata (redirect to S3, token acceptance, chunk layout of real files, speed).
