"""Command line: search NISAR catalogue and list candidate before/after pairs.
  python -m pipeline.nisar.cli --bbox W S E N --start 2025-10-01 --end 2025-12-31 [--level GCOV] [--max 50]"""
import argparse, json, sys
from .catalog import search, find_pairs, CatalogError

def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--start"); ap.add_argument("--end")
    ap.add_argument("--level", default="GCOV"); ap.add_argument("--max", type=int, default=50)
    a = ap.parse_args(argv)
    try:
        res = search(a.bbox, a.start, a.end, a.level, a.max)
    except (ValueError, CatalogError) as e:
        print(f"ERROR: {e}", file=sys.stderr); return 2
    pairs = find_pairs(res["records"])
    print(json.dumps({"query": res["query"], "returned": res["returned"], "usable": res["usable"],
                      "granules": [{k: r[k] for k in ("granuleId", "startTime", "flightDirection", "pathNumber", "frameNumber", "polarization")} for r in res["records"]],
                      "pairs": pairs, "note": res["note"] + (" No compatible pairs found." if not pairs else "")}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
