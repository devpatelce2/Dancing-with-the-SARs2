"""Sentinel-1 scene discovery through OPERA RTC-S1 (analysis-ready, terrain-corrected gamma0 backscatter, 30 m, one product per burst).

Why OPERA RTC-S1 and not raw GRD: GRD must be calibrated and terrain-corrected before it can be compared between dates; RTC-S1 already is,
so it plays the same role for Sentinel-1 that GCOV plays for NISAR. Catalogue search only: no pixels are read here.

A Sentinel-1 burst is only about 20 km long, so a 22 km box usually needs 2-3 bursts from the SAME pass. We therefore:
  1. search OPERA-S1 / RTC over the box,
  2. group results into passes (bursts of one track acquired within minutes of each other),
  3. pick ONE track (relative orbit + direction) so every date has the same viewing geometry,
  4. return, per pass, the list of burst files that together cover the box.
One pass becomes ONE line of scenes.txt: the burst file URLs separated by spaces (the reader mosaics them).

NOT VERIFIED against the live ASF service in the authoring environment (no network): the product naming and the
`_VV.tif` / `_mask.tif` file-name convention follow ASF's OPERA documentation as understood by the authors. Run
`python -m pipeline.check_sentinel1 --place "Noto, Japan" --start 2023-12-14 --end 2024-02-15 --probe` once to confirm both against the live service.
"""
from __future__ import annotations
import re
from collections import defaultdict
from datetime import datetime, timezone

from shapely.geometry import Point, shape
from shapely.ops import unary_union

from ..nisar import catalog

NAME_RE = re.compile(r"OPERA_L2_RTC-S1_(?P<burst>T(?P<track>\d{3})-\d{6}-IW[123])_(?P<acq>\d{8}T\d{6})Z_(?P<prod>\d{8}T\d{6})Z_(?P<sat>S1[A-D])_(?P<res>\d+)_v(?P<ver>[\d.]+)")
FILE_SUFFIX = re.compile(r"(_(VV|VH|HH|HV|mask))?\.(tif|tiff|h5|xml|iso\.xml)$", re.I)
PASS_GAP_MIN = 10.0   # bursts of one pass are seconds to a few minutes apart; different passes are days apart
MIN_COVER_KEEP = 0.9  # keep passes covering at least this fraction of the best pass's coverage of the box


def parse_name(name: str) -> dict | None:
    m = NAME_RE.search(str(name))
    if not m: return None
    return {"burstId": m["burst"], "track": int(m["track"]),
            "acquired": datetime.strptime(m["acq"], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc), "satellite": m["sat"]}


def layer_url(record: dict, kind: str) -> str | None:
    """URL of the `VV`/`VH`/`HH`/`HV` backscatter GeoTIFF or the `mask` GeoTIFF of an OPERA RTC-S1 record.
    Uses a URL ASF lists for exactly that layer when there is one; otherwise derives it from any file URL of the same product."""
    raw = record.get("raw") or {}
    urls = [record.get("downloadUrl"), raw.get("url")]
    extra = raw.get("additionalUrls")
    urls += extra if isinstance(extra, list) else ([extra] if extra else [])
    urls = [u for u in urls if isinstance(u, str) and u.lower().startswith("https://")]
    want = f"_{kind}.tif".lower()
    for u in urls:
        if u.lower().endswith(want): return u
    return FILE_SUFFIX.sub(f"_{kind}.tif", urls[0]) if urls else None


def _cover_fraction(geoms, bbox, n: int = 12) -> float:
    """Share of the box covered by the union of burst footprints (n x n sample points)."""
    if not geoms: return 0.0
    u = unary_union(geoms)
    w, s, e, nn = bbox
    pts = [Point(w + (i + 0.5) * (e - w) / n, s + (j + 0.5) * (nn - s) / n) for i in range(n) for j in range(n)]
    return sum(u.contains(p) for p in pts) / len(pts)


def _passes(records: list[dict]) -> list[list[dict]]:
    """Cluster records of ONE track into passes: a new pass starts when the gap to the previous burst exceeds PASS_GAP_MIN."""
    recs = sorted(records, key=lambda r: r["_t"])
    out: list[list[dict]] = []
    for r in recs:
        if out and (r["_t"] - out[-1][-1]["_t"]).total_seconds() / 60 <= PASS_GAP_MIN: out[-1].append(r)
        else: out.append([r])
    return out


def select(records: list[dict], bbox, polarization: str = "VV", track: int | None = None, direction: str | None = None):
    """Returns (summary_lines, chosen_key | None, passes, reason). Each pass = {"when": iso, "cover": 0..1, "records": [...], "urls": [...]}.
    Chooses the track with the most passes that cover the box well; ties go to the better coverage."""
    good = []
    for r in records:
        info = parse_name(r.get("granuleId") or "")
        if not info or not r.get("geometry") or not layer_url(r, polarization): continue
        r = dict(r); r["_t"] = info["acquired"]
        r["_track"] = info["track"]; r["_dir"] = (r.get("flightDirection") or "?")[:1].upper()
        good.append(r)
    if not good:
        return [], None, [], "no usable Sentinel-1 RTC records (missing name, footprint or file URL)"

    by_track: dict = defaultdict(list)
    for r in good: by_track[(r["_track"], r["_dir"])].append(r)
    if track is not None or direction:
        by_track = {k: v for k, v in by_track.items()
                    if (track is None or k[0] == int(track)) and (not direction or k[1] == direction.upper()[0])}
        if len(by_track) != 1:
            return [], None, [], f"{len(by_track)} tracks match the filters; narrow them (need exactly 1)"

    scored = {}
    for k, recs in by_track.items():
        passes = []
        for p in _passes(recs):
            geoms = [shape(r["geometry"]) for r in p]
            passes.append({"when": p[0]["_t"].isoformat(), "cover": _cover_fraction(geoms, bbox), "records": p})
        best = max(x["cover"] for x in passes)
        kept = [x for x in passes if best > 0 and x["cover"] >= MIN_COVER_KEEP * best]
        scored[k] = {"all": passes, "kept": kept, "best": best}

    lines = []
    for k, v in sorted(scored.items(), key=lambda kv: (-len(kv[1]["kept"]), -kv[1]["best"])):
        d = [x["when"][:10] for x in v["kept"]]
        lines.append(f"  (track {k[0]}, {k[1]}): {len(v['kept'])} passes, {d[0]}..{d[-1]}, box coverage up to {100 * v['best']:.0f}%" if d
                     else f"  (track {k[0]}, {k[1]}): no pass touches the box")
    chosen = max(scored, key=lambda k: (len(scored[k]["kept"]), scored[k]["best"]))
    passes = scored[chosen]["kept"]
    if not passes: return lines, None, [], "no Sentinel-1 pass covers the box"
    for p in passes:
        recs = sorted(p["records"], key=lambda r: r.get("burstId") or r["granuleId"])
        p["records"] = recs
        p["urls"] = [layer_url(r, polarization) for r in recs]
    return lines, chosen, passes, None


def scene_lines(passes: list[dict]) -> list[str]:
    """scenes.txt lines: one pass per line, burst URLs separated by spaces."""
    return [" ".join(p["urls"]) for p in passes]
