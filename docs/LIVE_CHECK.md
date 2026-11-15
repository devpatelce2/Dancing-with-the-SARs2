# Live integration check

Run on 2026-11-15 10:38 UTC with `python -m pipeline.verify_live`.

| Result | Integration | What came back |
|---|---|---|
| PASS | ASF Search API health | ASF Search API healthy: {'ASFSearchAPI': {'ok?': True, 'version': 'unknown', 'config': {'bulk_download_a |
| PASS | ASF search: NISAR GCOV | 25 NISAR GCOV scenes over Sylhet since 2026-06-18; first: track 141 ASCENDING frame 14 |
| PASS | ASF search: Sentinel-1 OPERA RTC | 20 OPERA RTC-S1 bursts over Noto; name format parsed |
| SKIP | Earthdata token | EARTHDATA_TOKEN is not set in this terminal |
| SKIP | NISAR file: authenticated stream | needs EARTHDATA_TOKEN |
| PASS | Place search (geocoder) | 'Sylhet, Bangladesh' -> 24.736, 91.685 (Sylhet Division, Bangladesh) |
| PASS | USGS earthquake feed | 20 M4.5+ earthquakes in the last 7 days |
| PASS | NASA EONET event feed | 5 open natural events returned |
| PASS | Basemap tiles (Esri) | Esri World Imagery tile served (18 KB, image/jpeg) |
