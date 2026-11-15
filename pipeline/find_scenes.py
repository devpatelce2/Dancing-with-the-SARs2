"""Find satellite scenes over your box and write their https links to a text file (METADATA ONLY, nothing is downloaded).

NISAR GCOV (L-band, from late 2025):
  python -m pipeline.find_scenes --bbox 90.8 24.3 91.8 25.2 --start 2026-06-17 --end 2026-11-14 --out scenes.txt
Sentinel-1 via OPERA RTC-S1 (C-band, from 2014; use this for events before NISAR, e.g. Noto Jan 2024):
  python -m pipeline.find_scenes --mission sentinel1 --bbox 137.05 37.21 137.25 37.41 --start 2023-12-14 --end 2024-02-15 --out scenes.txt

Prints the track/direction/frame groups found. A time series needs ONE group: pick it with --track/--direction/--frame or --pick-largest.
For Sentinel-1 one line of the output file is one pass (several burst files separated by spaces, mosaicked when read).
Then: python -m pipeline.run_timeseries ... --files-from scenes.txt
Uses the ASF Search API (pipeline.nisar.catalog). NOT VERIFIED live in the authoring environment (no network)."""
from __future__ import annotations
import argparse, sys
from collections import defaultdict
from pathlib import Path
from .nisar import catalog


def group_key(r: dict):
    return (r.get("pathNumber"), r.get("flightDirection"), r.get("frameNumber"))


def select(records, track=None, direction=None, frame=None, pick_largest=False):
    recs = [r for r in records if r.get("downloadUrl") and str(r["downloadUrl"]).lower().endswith(".h5")]
    groups: dict = defaultdict(list)
    for r in recs: groups[group_key(r)].append(r)
    if track is not None or direction or frame is not None:
        def ok(k):
            return ((track is None or str(k[0]) == str(int(track))) and (not direction or str(k[1]).upper().startswith(direction.upper()[0]))
                    and (frame is None or str(k[2]) == str(int(frame))))
        chosen = [k for k in groups if ok(k)]
        if len(chosen) != 1:
            return groups, None, f"{len(chosen)} groups match the filters; narrow them (need exactly 1)"
        return groups, chosen[0], None
    if pick_largest and groups:
        return groups, max(groups, key=lambda k: len(groups[k])), None
    return groups, None, "choose one group with --track/--direction/--frame or --pick-largest"


def _sentinel1(a) -> int:
    from .sentinel1 import catalog as s1
    try:
        res = catalog.search(tuple(a.bbox), a.start, a.end, "RTC", a.max_results, dataset="OPERA-S1")
    except (catalog.CatalogError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr); return 2
    print(f"{res['usable']} Sentinel-1 RTC bursts found")
    if res["returned"] >= a.max_results:
        print(f"WARNING: hit the --max-results limit ({a.max_results}); shorten the date range so no passes are cut off", file=sys.stderr)
    if not res["usable"]:
        print(f"ERROR: no Sentinel-1 RTC-S1 scenes cover this box for {a.start}..{a.end or 'now'}. Try a wider date range or a larger area "
              "(OPERA RTC-S1 starts in 2014 over land but coverage depends on region).", file=sys.stderr); return 2
    lines, chosen, passes, why = s1.select(res["records"], tuple(a.bbox), a.pol or "VV", a.track, a.direction)
    print("tracks (relative orbit, direction): passes, first..last")
    print("\n".join(lines))
    if chosen is None:
        print(f"ERROR: {why}", file=sys.stderr); return 2
    out = [f"# Sentinel-1 track {chosen[0]} {chosen[1]} - {len(passes)} passes, {a.pol or 'VV'} (OPERA RTC-S1, ASF catalogue, {a.start}..{a.end or 'now'}); one pass per line"]
    out += s1.scene_lines(passes)
    Path(a.out).write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"OK: wrote {len(passes)} passes to {a.out} (chosen: track {chosen[0]} {chosen[1]})")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mission", choices=["nisar", "sentinel1"], default="nisar")
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--start", required=True); ap.add_argument("--end"); ap.add_argument("--max-results", type=int, default=250)
    ap.add_argument("--track", type=int); ap.add_argument("--direction", help="ASCENDING or DESCENDING"); ap.add_argument("--frame", type=int)
    ap.add_argument("--pol", help="Sentinel-1 only: VV (default), VH, HH or HV")
    ap.add_argument("--pick-largest", action="store_true"); ap.add_argument("--out", default="scenes.txt")
    a = ap.parse_args(argv)
    if a.mission == "sentinel1": return _sentinel1(a)
    try:
        res = catalog.search(tuple(a.bbox), a.start, a.end, "GCOV", a.max_results)
    except (catalog.CatalogError, ValueError) as e:
        print(f"ERROR: {e}\nIf ASF's API is down, select scenes in Vertex and paste each scene's file link into scenes.txt (one per line).", file=sys.stderr); return 2
    groups, chosen, why = select(res["records"], a.track, a.direction, a.frame, a.pick_largest)
    print(f"{res['usable']} GCOV scenes found; groups (track, direction, frame): scenes, first..last")
    for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        ts = sorted(r["startTime"][:10] for r in v)
        print(f"  {k}: {len(v)} scenes, {ts[0]}..{ts[-1]}{'   <== chosen' if k == chosen else ''}")
    if not groups:
        print(f"ERROR: no NISAR GCOV scenes cover this box for {a.start}..{a.end or 'now'}. NISAR launched in July 2025, so earlier dates "
              "have no data; also try a wider date range or a larger area, or use --mission sentinel1.", file=sys.stderr); return 2
    if chosen is None:
        print(f"ERROR: {why}", file=sys.stderr); return 2
    recs = sorted(groups[chosen], key=lambda r: r["startTime"])
    lines = [f"# track {chosen[0]} {chosen[1]} frame {chosen[2]} - {len(recs)} GCOV scenes (ASF catalogue, {a.start}..{a.end or 'now'})"]
    lines += [f"{r['downloadUrl']}" for r in recs]
    Path(a.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK: wrote {len(recs)} links to {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
