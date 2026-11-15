"""Rebuild public/data/sites.json from the site folders that actually exist, so a site can never be processed but missing from the app.
A folder with timeseries.json is listed as a time series; a folder with only meta.json (single before/after pair) is listed as a pair.
python -m pipeline.rebuild_index [--data public/data]        (the same scan also runs on `npm run dev` / `npm run build`)"""
from __future__ import annotations
import argparse, json, os, re
from pathlib import Path

SITE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def scan(root: Path) -> list[dict]:
    sites = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()) if root.is_dir() else []:
        if not SITE_ID.match(d.name): continue
        for fname, kind in (("timeseries.json", "timeseries"), ("meta.json", None)):
            f = d / fname
            if not f.is_file(): continue
            try: j = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError): continue
            if not isinstance(j, dict): continue
            e = {"id": d.name, "name": str(j.get("name") or d.name)}
            if kind: e["kind"] = kind
            sites.append(e); break
    return sites


def rebuild(root: Path) -> list[dict]:
    sites = scan(root); root.mkdir(parents=True, exist_ok=True)
    tmp = root / "sites.json.tmp"
    tmp.write_text(json.dumps({"schemaVersion": 1, "sites": sites}, indent=2), encoding="utf-8")
    os.replace(tmp, root / "sites.json")  # atomic: a crash can never leave a half-written index
    return sites


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--data", default="public/data"); a = ap.parse_args(argv)
    sites = rebuild(Path(a.data))
    print(f"OK: {len(sites)} site(s) listed: {', '.join(s['id'] for s in sites) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
