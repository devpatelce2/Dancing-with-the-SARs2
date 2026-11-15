"""List independent water-extent reference products (OPERA DSWx) over a processed site, from NASA's public CMR catalogue.

  python -m pipeline.find_reference --site-dir public/data/sylhet --sar-date 2026-07-14 --days 6
  python -m pipeline.find_reference --site-dir public/data/sylhet --sar-date 2026-07-14 --product hls

Why DSWx: it is made by a different team with a different algorithm and ancillary data (HAND, land cover, reference water), so
agreement with it means more than agreement with our own baseline. DSWx-S1 is also radar (Sentinel-1, C-band): it is independent
of our NISAR L-band pipeline, not an optical ground truth. DSWx-HLS is optical and cloud-limited, which matters in monsoon.
Prints download URLs only; downloading needs your Earthdata token (EARTHDATA_TOKEN). Nothing here fetches or invents a map."""
import argparse, json, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
PRODUCTS = {"s1": "OPERA_L3_DSWX-S1_V1", "hls": "OPERA_L3_DSWX-HLS_V1"}
DATA_REL = "http://esipfed.org/ns/fedsearch/1.1/data#"
WATER_LAYER = "_B01_WTR"  # the interpreted water classification: 1 open water, 2 moderate confidence, 3 inundated vegetation, 250+ masked


def cmr_url(short_name, bounds, start, end, page_size=50):
    w, s, e, n = bounds
    q = {"short_name": short_name, "bounding_box": f"{w},{s},{e},{n}", "temporal": f"{start:%Y-%m-%dT%H:%M:%SZ},{end:%Y-%m-%dT%H:%M:%SZ}",
         "page_size": page_size, "sort_key": "start_date"}
    return f"{CMR}?{urlencode(q)}"


def parse_entries(payload, layer=WATER_LAYER):
    """-> [{time, title, url}] for the water-classification file of each granule. Pure function (tested offline)."""
    out = []
    for e in (payload or {}).get("feed", {}).get("entry", []):
        urls = [l.get("href", "") for l in e.get("links", []) if l.get("rel") == DATA_REL and l.get("href", "").lower().endswith(".tif")]
        wtr = [u for u in urls if layer in u]
        if wtr: out.append({"time": e.get("time_start"), "title": e.get("title"), "url": wtr[0]})
    return out


def main(argv=None, opener=urlopen) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-dir", required=True); ap.add_argument("--sar-date", required=True, help="YYYY-MM-DD of the scene you will score")
    ap.add_argument("--days", type=int, default=6, help="search +/- this many days around the SAR date"); ap.add_argument("--product", choices=sorted(PRODUCTS), default="s1")
    a = ap.parse_args(argv)
    try:
        ts = json.loads((Path(a.site_dir) / "timeseries.json").read_text())
        bounds = ts["bounds"]; d = datetime.strptime(a.sar_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (OSError, KeyError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr); return 2
    url = cmr_url(PRODUCTS[a.product], bounds, d - timedelta(days=a.days), d + timedelta(days=a.days))
    try:
        with opener(Request(url, headers={"Accept": "application/json"}), timeout=30) as r: payload = json.load(r)
    except Exception as e:  # network or CMR failure: say so, never guess
        print(f"ERROR: could not reach NASA CMR ({e}). Open this URL in a browser instead:\n{url}", file=sys.stderr); return 3
    found = parse_entries(payload)
    if not found:
        print(f"No {PRODUCTS[a.product]} water maps within {a.days} days of {a.sar_date} over this site. Try --days 12 or --product {'hls' if a.product == 's1' else 's1'}."); return 1
    print(f"{len(found)} {PRODUCTS[a.product]} water maps over the site (SAR scene {a.sar_date}):")
    for f in found: print(f"  {f['time']}  {f['url']}")
    print('\nDownload with:  curl -L -H "Authorization: Bearer $EARTHDATA_TOKEN" -O <url>\nThen score:  python -m pipeline.validate --site-dir', a.site_dir, "--sar-date", a.sar_date, "--reference <file.tif> --name \"OPERA DSWx\" --source \"NASA JPL OPERA via PO.DAAC\" --date <map date YYYY-MM-DD>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
