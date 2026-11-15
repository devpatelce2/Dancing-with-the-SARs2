"""NISAR catalogue search through the ASF DAAC Search API (metadata only - NO radar pixels are read here).

Everything returned is passed through from ASF. Fields ASF does not provide stay None; nothing is guessed.
Pair compatibility is evaluated ONLY on fields actually present, and unknown fields are reported as unknown.
Docs: https://docs.asf.alaska.edu/api/keywords/
"""
from __future__ import annotations
import math
import re
from datetime import datetime, timezone
from typing import Any, Callable

import requests

from ..config import ASF_SEARCH_URL, REQUEST_TIMEOUT_S

NISAR_LEVELS = {"GCOV", "GSLC", "RSLC", "RIFG", "RUNW", "GUNW", "GOFF", "ROFF", "SME2", "L0B"}
OPERA_S1_LEVELS = {"RTC"}  # OPERA analysis-ready Sentinel-1 backscatter (dataset "OPERA-S1")
MAX_RESULTS_CAP = 250


class CatalogError(RuntimeError):
    """Raised for network/HTTP/shape problems; message is safe to show to users."""


def validate_bbox(w: float, s: float, e: float, n: float) -> tuple[float, float, float, float]:
    vals = (w, s, e, n)
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
        raise ValueError("bbox must be four finite numbers [west, south, east, north]")
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("bbox must satisfy -180<=west<east<=180 and -90<=south<north<=90")
    if (e - w) * (n - s) > 100:
        raise ValueError("AOI too large (>100 square degrees); choose a smaller area")
    return w, s, e, n


def bbox_to_wkt(w: float, s: float, e: float, n: float) -> str:
    return f"POLYGON(({w:.5f} {s:.5f},{e:.5f} {s:.5f},{e:.5f} {n:.5f},{w:.5f} {n:.5f},{w:.5f} {s:.5f}))"


def _parse_time(v: Any) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def build_params(bbox, start: str | None, end: str | None, processing_level: str = "GCOV", max_results: int = 50,
                 dataset: str = "NISAR") -> dict:
    levels = {"NISAR": NISAR_LEVELS, "OPERA-S1": OPERA_S1_LEVELS}.get(dataset)
    if levels is None:
        raise ValueError("dataset must be NISAR or OPERA-S1")
    if processing_level not in levels:
        raise ValueError(f"processing_level must be one of {sorted(levels)}")
    if not (1 <= int(max_results) <= MAX_RESULTS_CAP):
        raise ValueError(f"max_results must be 1..{MAX_RESULTS_CAP}")
    p = {"dataset": dataset, "processingLevel": processing_level, "maxResults": int(max_results), "output": "geojson",
         "intersectsWith": bbox_to_wkt(*validate_bbox(*bbox))}
    for k, v in (("start", start), ("end", end)):
        if v:
            if _parse_time(v) is None:
                raise ValueError(f"{k} must be an ISO-8601 date/time")
            p[k] = v
    if start and end and _parse_time(start) > _parse_time(end):
        raise ValueError("start must not be after end")
    return p


def normalize_feature(f: dict) -> dict | None:
    """ASF GeoJSON feature -> record. `raw` keeps ALL original properties so nothing is lost or reinterpreted."""
    p = f.get("properties") or {}
    scene = p.get("sceneName") or p.get("fileID") or p.get("granuleName")
    start = _parse_time(p.get("startTime"))
    if not scene or start is None or not f.get("geometry"):
        return None
    return {
        "granuleId": scene, "platform": p.get("platform"), "processingLevel": p.get("processingLevel"),
        "startTime": start.isoformat(), "stopTime": (_parse_time(p.get("stopTime")) or start).isoformat(),
        "flightDirection": (str(p["flightDirection"]).upper() if p.get("flightDirection") else None),
        "pathNumber": p.get("pathNumber"), "frameNumber": p.get("frameNumber"),
        "polarization": p.get("polarization"), "beamMode": p.get("beamModeType") or p.get("beamMode"),
        "burstId": p.get("operaBurstID"), "downloadUrl": p.get("url"), "bytes": p.get("bytes"), "geometry": f["geometry"], "raw": p,
    }


def search(bbox, start=None, end=None, processing_level="GCOV", max_results=50,
           http_get: Callable = requests.get, dataset: str = "NISAR") -> dict:
    params = build_params(bbox, start, end, processing_level, max_results, dataset)
    try:
        r = http_get(ASF_SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT_S, headers={"Accept": "application/geo+json"})
    except requests.Timeout as e:
        raise CatalogError("ASF catalogue timed out; try again or reduce the query") from e
    except requests.RequestException as e:
        raise CatalogError("ASF catalogue is unreachable (network error)") from e
    if r.status_code != 200:
        raise CatalogError(f"ASF catalogue returned HTTP {r.status_code}")
    try:
        fc = r.json()
    except ValueError as e:
        raise CatalogError("ASF returned a non-JSON response") from e
    if not isinstance(fc, dict) or fc.get("type") != "FeatureCollection":
        raise CatalogError("ASF response was not a GeoJSON FeatureCollection")
    feats = fc.get("features", [])
    records = [x for x in (normalize_feature(f) for f in feats) if x]
    return {"query": params, "returned": len(feats), "usable": len(records), "records": records,
            "note": "Catalogue metadata only. No radar pixel data has been downloaded."}


def _overlap_fraction(a: dict, b: dict) -> float | None:
    """Bounding-box overlap of two footprints as a fraction of the smaller one (None if geometry unusable)."""
    def box(g):
        pts = []
        def walk(c):
            if c and isinstance(c[0], (int, float)): pts.append(c)
            else:
                for x in c: walk(x)
        walk(g.get("coordinates", []))
        if not pts: return None
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)
    A, B = box(a["geometry"]), box(b["geometry"])
    if not A or not B: return None
    w, e = max(A[0], B[0]), min(A[2], B[2]); s, n = max(A[1], B[1]), min(A[3], B[3])
    if w >= e or s >= n: return 0.0
    area = lambda t: (t[2] - t[0]) * (t[3] - t[1])
    return ((e - w) * (n - s)) / min(area(A), area(B))


def find_pairs(records: list[dict], min_days: float = 1.0, min_overlap: float = 0.8) -> list[dict]:
    """Candidate before/after pairs. A pair is 'compatible' only if every checkable field matches; fields that the
    catalogue did not provide are listed under `unknown` so a human (or the HDF5 stage) must confirm them."""
    recs = sorted(records, key=lambda r: r["startTime"])
    out = []
    for i, a in enumerate(recs):
        for b in recs[i + 1:]:
            days = (datetime.fromisoformat(b["startTime"]) - datetime.fromisoformat(a["startTime"])).total_seconds() / 86400
            if days < min_days: continue
            checks, unknown, ok = {}, [], True
            for k in ("flightDirection", "pathNumber", "frameNumber", "polarization", "processingLevel"):
                va, vb = a.get(k), b.get(k)
                if va is None or vb is None: unknown.append(k)
                else:
                    checks[k] = va == vb
                    ok &= va == vb
            ov = _overlap_fraction(a, b)
            if ov is None: unknown.append("footprint")
            else:
                checks["footprintOverlap"] = ov >= min_overlap
                ok &= ov >= min_overlap
            if ok:
                out.append({"before": a["granuleId"], "after": b["granuleId"], "daysApart": round(days, 3),
                            "footprintOverlap": ov, "unknownFields": unknown, "checks": checks,
                            "status": "candidate-needs-confirmation" if unknown else "metadata-compatible"})
    return out
