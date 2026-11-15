"""One command: find scenes for a small box, read ONLY that box, build the time series.

Missions: NISAR GCOV (L-band, data from late 2025) or Sentinel-1 via OPERA RTC-S1 (C-band, data from 2014).
--mission auto (default) uses NISAR when it has scenes for your dates and falls back to Sentinel-1 when it has none.

  set EARTHDATA_TOKEN first (never commit it), then, for example:
  python -m pipeline.quick --place "Noto, Ishikawa, Japan" --event "Noto earthquake" --start 2023-12-14 --end 2024-02-15 \\
     --event-date 2024-01-01 --threshold-db -3
  python -m pipeline.quick --site-id sylhet --name Sylhet --event "Monsoon flood" --place "Sylhet, Bangladesh" --start 2026-10-01 \\
     --track 91 --direction DESCENDING --frame 76 --threshold-db -3 --event-date 2026-07-15
NISAR files are streamed (only the box is read). Sentinel-1 burst files (about 10-40 MB each) are downloaded once into ./.cache/sentinel1."""
from __future__ import annotations
import argparse, re, sys, tempfile
from pathlib import Path
from . import find_scenes, run_timeseries


def spread(urls, n):
    """Sort scene links by acquisition time; if more than n, keep n evenly spaced ones including the first and last."""
    from .processing.timeseries import parse_scene_name
    ls = sorted({u.strip() for u in urls if u.strip() and not u.lstrip().startswith("#")}, key=lambda u: parse_scene_name(u)["startUtc"] or "")
    if n >= 2 and len(ls) > n: ls = [ls[round(i * (len(ls) - 1) / (n - 1))] for i in range(n)]
    return ls


def pick_around(urls, n, event_date):
    """With an event date: keep a baseline from before it and the first scenes at/after it (these show the event and its recovery),
    instead of spreading evenly over a long range that can skip the event or leave fewer than 2 baseline scenes."""
    from .processing.timeseries import parse_scene_name
    ls = spread(urls, 0)
    when = lambda u: (parse_scene_name(u)["startUtc"] or "")[:10]
    before = [u for u in ls if when(u) < event_date]; after = [u for u in ls if when(u) >= event_date]
    nb = min(len(before), max(2, n // 2)); na = min(len(after), n - nb)
    nb = min(len(before), n - na)  # give unused after-slots to the baseline
    base = before[-1:] if nb == 1 else (spread(before, nb) if nb else [])
    return base + after[:na]


def one_per_pass(urls):
    """ASF can list two products of the same satellite pass. Keep one, BEFORE scenes are chosen: otherwise a pair of duplicates
    can use up two of the --max-scenes slots and leave too few distinct dates (the Nepal site was built with this fault)."""
    from .processing.timeseries import dedupe_acquisitions
    ls = [u.strip() for u in urls if u.strip() and not u.lstrip().startswith("#")]
    kept, dropped = dedupe_acquisitions(ls)
    return kept, len(dropped)


S1_POL = {"HHHH": "VV", "VVVV": "VV", "HVHV": "VH", "VHVH": "VH", "VV": "VV", "VH": "VH"}  # nearest Sentinel-1 channel


def resolve_mission(a, bbox) -> str | None:
    """'nisar' or 'sentinel1'. In auto mode a metadata-only NISAR search decides."""
    if a.mission != "auto": return a.mission
    from .nisar import catalog
    try:
        res = catalog.search(tuple(bbox), a.start, a.end, "GCOV", 1)
    except (catalog.CatalogError, ValueError) as ex:
        print(f"ERROR: {ex}", file=sys.stderr); return None
    if res["usable"]:
        print("Mission: NISAR (L-band) has scenes for these dates."); return "nisar"
    print("Mission: NISAR has no scenes for these dates (it launched in July 2025); using Sentinel-1 (C-band, OPERA RTC-S1).")
    return "sentinel1"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-id", help="optional; made from --place if omitted"); ap.add_argument("--name"); ap.add_argument("--event", required=True)
    ap.add_argument("--country"); ap.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"), help="optional if --place is given")
    ap.add_argument("--place", help='place name, e.g. "Sylhet, Bangladesh"; a ~22 km box is built around it')
    ap.add_argument("--half-deg", type=float, default=0.1)
    ap.add_argument("--mission", choices=["auto", "nisar", "sentinel1"], default="auto")
    ap.add_argument("--start", required=True); ap.add_argument("--end")
    ap.add_argument("--track"); ap.add_argument("--direction"); ap.add_argument("--frame", help="NISAR only")
    ap.add_argument("--pol", help="default HHHH for NISAR, VV for Sentinel-1")
    ap.add_argument("--threshold-db", type=float, required=True)
    ap.add_argument("--event-date"); ap.add_argument("--downsample", type=int, help="default 8 for NISAR (10 m pixels), 1 for Sentinel-1 (30 m pixels)")
    ap.add_argument("--max-results", type=int, default=250)
    ap.add_argument("--max-scenes", type=int, default=6, help="use N scenes spread evenly across the date range (0 = all)")
    a = ap.parse_args(argv)
    if a.place:
        from .geocode import place_to_bbox
        try: *box, shown = place_to_bbox(a.place, a.half_deg)
        except (ValueError, OSError) as ex: print(f"ERROR: {ex}", file=sys.stderr); return 2
        a.bbox = box; print(f"Place: {shown}\nBox (W S E N): {box}")
    if not a.bbox: print("ERROR: give --place or --bbox", file=sys.stderr); return 2
    if not a.site_id:
        a.site_id = re.sub(r"[^a-z0-9]+", "-", (a.place or "site").split(",")[0].lower()).strip("-") or "site"
    if not a.name and a.place: a.name = a.place.split(",")[0].strip()
    bbox = [str(v) for v in a.bbox]
    w, s_, e, n_ = a.bbox
    mission = resolve_mission(a, a.bbox)
    if mission is None: return 2
    from .processing.timeseries import parse_scene_name
    when = lambda u: (parse_scene_name(u)["startUtc"] or "")[:10]
    scenes = Path(tempfile.gettempdir()) / f"{a.site_id}_scenes.txt"
    for attempt in (1, 2):
        s1 = mission == "sentinel1"
        if s1 and a.pol and a.pol.upper() not in ("VV", "VH"):
            pol = S1_POL.get(a.pol.upper())
            if not pol: print(f"ERROR: --pol {a.pol} is not a Sentinel-1 channel; use VV or VH", file=sys.stderr); return 2
            print(f"Sentinel-1 has no {a.pol} channel; using {pol}."); a.pol = pol
        px = 900 if s1 else 100  # m^2 per pixel: 30 m vs ~10 m
        mpx = (e - w) * 111e3 * (n_ - s_) * 111e3 / px / 1e6
        if s1: print(f"Box is about {mpx:.1f} M pixels per date at 30 m. Sentinel-1 burst files are downloaded once and cached in ./.cache/sentinel1.")
        else: print(f"Box is about {mpx:.0f} M pixels per scene at full resolution (all of it is downloaded; --downsample does NOT reduce download).")
        if mpx > (6 if s1 else 25): print("WARNING: large box, likely slow. Try a box of about 0.2 x 0.2 degrees or smaller.", file=sys.stderr)
        fs = ["--mission", mission, "--bbox", *bbox, "--start", a.start, "--max-results", str(a.max_results), "--out", str(scenes)]
        if s1 and a.pol: fs += ["--pol", a.pol]
        for k in ("end", "track", "direction") + (() if s1 else ("frame",)):
            if getattr(a, k): fs += [f"--{k}", str(getattr(a, k))]
        if not s1 and not (a.track or a.direction or a.frame): fs.append("--pick-largest")  # several track groups usually match: use the one with most scenes
        if find_scenes.main(fs) not in (0, None): return 1
        raw = scenes.read_text(encoding="utf-8").splitlines()
        if not s1:
            raw, ndup = one_per_pass(raw)
            if ndup: print(f"Skipped {ndup} duplicate product(s) of passes that are already listed.")
        before = [u for u in raw if a.event_date and when(u) and when(u) < a.event_date]
        if a.event_date and len(before) < 2 and not s1 and a.mission == "auto" and attempt == 1:
            # NISAR's calibrated archive starts in mid-2026; an event near that start has no "before" picture. Sentinel-1 goes back to 2014.
            print(f"NISAR has only {len(before)} scene(s) before {a.event_date}; a baseline needs at least 2. Switching to Sentinel-1.")
            mission = "sentinel1"; continue
        break
    if a.event_date and len(before) < 2:
        print(f"ERROR: only {len(before)} scene(s) before the event date {a.event_date}; at least 2 are needed for a baseline. "
              "Move --start earlier" + ("" if s1 else ", or add --mission sentinel1") + ".", file=sys.stderr); return 2
    if len(raw) < 3:
        print(f"ERROR: only {len(raw)} distinct acquisition date(s) found; a time series needs at least 3. Widen --start/--end.", file=sys.stderr); return 2
    if a.max_scenes:
        ls = pick_around(raw, a.max_scenes, a.event_date) if a.event_date else spread(raw, a.max_scenes)
    else: ls = spread(raw, 0)
    scenes.write_text("\n".join(ls) + "\n", encoding="utf-8")
    print(f"Using {len(ls)} scenes: " + ", ".join((when(u) or "?") for u in ls))
    ts = ["--mission", "SENTINEL-1" if s1 else "NISAR", "--site-id", a.site_id, "--event", a.event, "--bbox", *bbox,
          "--pol", a.pol or ("VV" if s1 else "HHHH"), "--threshold-db", str(a.threshold_db), "--files-from", str(scenes)]
    if a.downsample: ts += ["--downsample", str(a.downsample)]
    for k in ("name", "country", "event_date"):
        if getattr(a, k): ts += [f"--{k.replace('_', '-')}", getattr(a, k)]
    return run_timeseries.main(ts) or 0


if __name__ == "__main__":
    raise SystemExit(main())
