"""One command to check every LIVE integration this project depends on. Run it on a connected machine:

    python -m pipeline.verify_live                 (set EARTHDATA_TOKEN first to include the authenticated NISAR read)

Each line is PASS, FAIL or SKIP with what was actually returned. Nothing here uses fixtures: a PASS means the real service answered
in the shape the code expects, at the time printed. The exit code is 1 if anything failed. Paste the output into docs/LIVE_CHECK.md
(or use --write) so the submission can state exactly what was verified and when."""
from __future__ import annotations
import argparse, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import requests

BOX = (91.58, 24.63, 91.79, 24.84)  # Sylhet test box (W, S, E, N)
UA = {"User-Agent": "dancing-with-the-sars/0.1 (live check)"}


def _get(url, **kw):
    r = requests.get(url, timeout=30, headers=UA, **kw); r.raise_for_status(); return r


def check_asf_health():
    j = _get("https://api.daac.asf.alaska.edu/health").json()
    return f"ASF Search API healthy: {str(j)[:80]}"


def check_nisar_search(state):
    from .nisar import catalog
    start = (datetime.now(timezone.utc) - timedelta(days=150)).strftime("%Y-%m-%d")
    res = catalog.search(BOX, start, None, "GCOV", 25)
    recs = [r for r in res["records"] if r.get("downloadUrl")]
    if not recs: raise RuntimeError(f"search worked but returned no NISAR GCOV scene with a download link since {start}")
    state["nisar_url"] = recs[0]["downloadUrl"]
    need = ("pathNumber", "flightDirection", "frameNumber", "startTime")
    missing = [k for k in need if recs[0].get(k) in (None, "")]
    if missing: raise RuntimeError(f"records are missing fields the pipeline groups by: {missing}")
    return f"{len(recs)} NISAR GCOV scenes over Sylhet since {start}; first: track {recs[0]['pathNumber']} {recs[0]['flightDirection']} frame {recs[0]['frameNumber']}"


def check_sentinel1_search():
    from .nisar import catalog
    from .sentinel1.catalog import parse_name
    res = catalog.search((137.04, 37.21, 137.25, 37.41), "2023-12-01", "2024-01-20", "RTC", 20, dataset="OPERA-S1")
    recs = res["records"]
    if not recs: raise RuntimeError("no OPERA RTC-S1 bursts returned for Noto, Dec 2023 - Jan 2024 (the Noto site was built from these)")
    name = str(recs[0].get("granuleId") or "")
    if not parse_name(name): raise RuntimeError(f"scene name no longer matches the parser: {name[:90]}")
    return f"{len(recs)} OPERA RTC-S1 bursts over Noto; name format parsed"


def check_token():
    from .config import load_auth
    if not load_auth().available: raise LookupError("EARTHDATA_TOKEN is not set in this terminal")
    return "Earthdata token is set (value not shown)"


def check_nisar_stream(state):
    from .config import load_auth
    if not load_auth().available: raise LookupError("needs EARTHDATA_TOKEN")
    if not state.get("nisar_url"): raise LookupError("needs the NISAR search to pass first")
    from .nisar.remote import open_h5
    from .nisar.gcov_reader import available_layers
    t = time.time()
    with open_h5(state["nisar_url"], block_size=1 << 20) as (f, rf):
        layers = available_layers(f); got = rf.describe()
    if not layers: raise RuntimeError("file opened but no backscatter layers were found where the reader looks")
    return f"opened a real GCOV file over HTTPS with the token and listed {len(layers)} layers ({', '.join(sorted({l[2] for l in layers}))}); {got}; {time.time() - t:.0f} s"


def check_geocoder():
    from .geocode import geocode
    lat, lon, name = geocode("Sylhet, Bangladesh")
    if not (24 < lat < 26 and 91 < lon < 93): raise RuntimeError(f"unexpected position {lat:.2f}, {lon:.2f} for Sylhet")
    return f"'Sylhet, Bangladesh' -> {lat:.3f}, {lon:.3f} ({name[:50]})"


def check_usgs():
    end = datetime.now(timezone.utc); start = end - timedelta(days=7)
    j = _get("https://earthquake.usgs.gov/fdsnws/event/1/query", params={"format": "geojson", "starttime": start.strftime("%Y-%m-%d"), "minmagnitude": 4.5, "limit": 20}).json()
    return f"{len(j.get('features', []))} M4.5+ earthquakes in the last 7 days"


def check_eonet():
    j = _get("https://eonet.gsfc.nasa.gov/api/v3/events", params={"status": "open", "limit": 5}).json()
    if "events" not in j: raise RuntimeError("response has no 'events' list")
    return f"{len(j['events'])} open natural events returned"


def check_basemap():
    r = _get("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/2")
    if not r.headers.get("Content-Type", "").startswith("image/"): raise RuntimeError(f"tile is not an image: {r.headers.get('Content-Type')}")
    return f"Esri World Imagery tile served ({len(r.content) // 1024} KB, {r.headers['Content-Type']})"


def run(checks, out=print) -> tuple[list[tuple[str, str, str]], int]:
    rows = []; failed = 0
    for name, fn in checks:
        t = time.time()
        try: status, msg = "PASS", fn()
        except LookupError as e: status, msg = "SKIP", str(e)
        except Exception as e:  # noqa: BLE001 - every failure is reported, none hidden
            status, msg = "FAIL", f"{type(e).__name__}: {str(e)[:220]}"; failed += 1
        rows.append((status, name, msg)); out(f"{status:4}  {name:34} {msg}  [{time.time() - t:.1f} s]")
    return rows, failed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--write", help="also write the result as Markdown, e.g. docs/LIVE_CHECK.md"); a = ap.parse_args(argv)
    state: dict = {}
    checks = [("ASF Search API health", check_asf_health), ("ASF search: NISAR GCOV", lambda: check_nisar_search(state)),
              ("ASF search: Sentinel-1 OPERA RTC", check_sentinel1_search), ("Earthdata token", check_token),
              ("NISAR file: authenticated stream", lambda: check_nisar_stream(state)), ("Place search (geocoder)", check_geocoder),
              ("USGS earthquake feed", check_usgs), ("NASA EONET event feed", check_eonet), ("Basemap tiles (Esri)", check_basemap)]
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"Live integration check, {when}\n")
    rows, failed = run(checks)
    skipped = sum(r[0] == "SKIP" for r in rows)
    print(f"\n{len(rows) - failed - skipped} passed, {failed} failed, {skipped} skipped")
    if a.write:
        lines = [f"# Live integration check", "", f"Run on {when} with `python -m pipeline.verify_live`.", "", "| Result | Integration | What came back |", "|---|---|---|"]
        lines += [f"| {s} | {n} | {m.replace('|', '/')} |" for s, n, m in rows]
        Path(a.write).write_text("\n".join(lines) + "\n", encoding="utf-8"); print(f"written to {a.write}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
