"""Independent validation of flood candidates against a reference raster (e.g. an authoritative event map or a
Sentinel-2/optical-derived water map that YOU produced and documented). Reports pixel-wise confusion metrics.
Nothing is computed unless a real reference is supplied; temporal mismatch between SAR and reference must be disclosed."""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject


def read_reference_on_grid(ref_path: str, shape, transform, epsg: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns (reference_flood_bool, reference_valid_bool) on the candidate grid (nearest neighbour)."""
    with rasterio.open(ref_path) as src:
        if src.crs is None: raise ValueError("reference raster has no CRS")
        data = np.full(shape, np.nan, dtype="float32")
        reproject(rasterio.band(src, 1), data, dst_transform=transform, dst_crs=CRS.from_epsg(epsg), resampling=Resampling.nearest,
                  src_nodata=src.nodata, dst_nodata=np.nan)
    valid = np.isfinite(data)
    return (np.nan_to_num(data, nan=0.0) > 0), valid


def confusion_metrics(candidate: np.ndarray, reference: np.ndarray, valid: np.ndarray) -> dict:
    if not (candidate.shape == reference.shape == valid.shape): raise ValueError("shape mismatch")
    c, r = candidate[valid].astype(bool), reference[valid].astype(bool)
    tp, fp = int((c & r).sum()), int((c & ~r).sum()); fn, tn = int((~c & r).sum()), int((~c & ~r).sum())
    div = lambda a, b: (a / b) if b else None
    prec, rec = div(tp, tp + fp), div(tp, tp + fn)
    f1 = div(2 * prec * rec, prec + rec) if prec is not None and rec is not None and (prec + rec) else None
    return {"pixelsCompared": int(valid.sum()), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": prec, "recall": rec, "f1": f1, "iou": div(tp, tp + fp + fn), "overallAccuracy": div(tp + tn, tp + fp + fn + tn)}


def validate_site(site_dir: Path, reference_path: str, *, reference_name: str, reference_source: str, reference_date: str,
                  notes: str = "") -> dict:
    """Compute metrics against `candidate.tif`/`change.tif` in site_dir and write them into meta.json['validation']."""
    for v, n in ((reference_name, "reference_name"), (reference_source, "reference_source"), (reference_date, "reference_date")):
        if not v or not str(v).strip(): raise ValueError(f"{n} is required: validation must document its independent reference")
    with rasterio.open(site_dir / "candidate.tif") as c: cand, tf, epsg = c.read(1).astype(bool), c.transform, c.crs.to_epsg()
    with rasterio.open(site_dir / "change.tif") as c: sar_valid = np.isfinite(c.read(1))
    ref, ref_valid = read_reference_on_grid(reference_path, cand.shape, tf, epsg)
    valid = sar_valid & ref_valid
    if valid.sum() == 0: raise ValueError("reference does not overlap any valid SAR pixels")
    m = confusion_metrics(cand, ref, valid)
    block = {"method": "pixel-wise confusion matrix against an independent reference raster (nearest-neighbour resampling to the SAR grid)",
             "reference": f"{reference_name} - {reference_source}", "referenceDate": reference_date,
             "metrics": m, "referenceCoverageOfSarValid": round(float(valid.sum() / max(sar_valid.sum(), 1)), 6),
             "caveats": ["Reference and SAR acquisition dates may differ; flood extent changes quickly.",
                         "Metrics describe agreement with THIS reference only, which has its own errors.", notes] if notes else
                        ["Reference and SAR acquisition dates may differ; flood extent changes quickly.",
                         "Metrics describe agreement with THIS reference only, which has its own errors."]}
    mp = site_dir / "meta.json"; meta = json.loads(mp.read_text(encoding="utf-8")); meta["validation"] = block
    mp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return block


# ---------------- time-series sites (public/data/<id>/timeseries.json + ts/*.png) ----------------
def _reference_classes(ref_path: str, shape, transform, water_values, invalid_min) -> tuple[np.ndarray, np.ndarray, dict]:
    """Reference on the candidate grid (EPSG:4326, nearest neighbour). Raster: class values; vector (GeoJSON etc.): polygons = water.
    Returns (water_bool, valid_bool, histogram of values seen)."""
    p = str(ref_path).lower()
    if p.endswith((".geojson", ".json", ".shp", ".gpkg")):
        import json as _json
        from rasterio.features import rasterize
        if not p.endswith((".geojson", ".json")): raise ValueError("vector references must be GeoJSON in EPSG:4326 (convert shapefiles first)")
        gj = _json.loads(Path(ref_path).read_text(encoding="utf-8"))
        feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
        geoms = [f.get("geometry", f) for f in feats if f.get("geometry", f)]
        if not geoms: raise ValueError("reference GeoJSON has no geometries")
        water = rasterize([(g, 1) for g in geoms], out_shape=shape, transform=transform, fill=0, dtype="uint8").astype(bool)
        return water, np.ones(shape, dtype=bool), {"polygons": len(geoms)}
    with rasterio.open(ref_path) as src:
        if src.crs is None: raise ValueError("reference raster has no CRS")
        data = np.full(shape, -1, dtype="float32")
        reproject(rasterio.band(src, 1), data, dst_transform=transform, dst_crs=CRS.from_epsg(4326), resampling=Resampling.nearest,
                  src_nodata=None, dst_nodata=-1)
        nodata = src.nodata
    valid = data >= 0
    if nodata is not None: valid &= data != nodata
    if invalid_min is not None: valid &= data < invalid_min
    vals, counts = np.unique(data[data >= 0].astype("int64"), return_counts=True)
    water = np.isin(data, list(water_values)) if water_values else (data > 0)
    return water & valid, valid, {int(v): int(c) for v, c in zip(vals, counts)}


def validate_timeseries(site_dir: Path, sar_date: str, reference_path: str, *, reference_name: str, reference_source: str,
                        reference_date: str, reference_baseline_path: str | None = None, water_values=(1, 2, 3), invalid_min: float | None = 250,
                        notes: str = "") -> dict:
    """Score one date's change candidates against an independent water/flood reference and store the result in timeseries.json.

    The candidates are "darker than the baseline", i.e. NEW water. A water-extent reference also contains rivers and lakes that were
    already there, so pass the same product for a baseline date as `reference_baseline_path`: the comparison is then
    new water (reference) vs new-water candidates (SAR). Without it, permanent water counts against recall, and the result says so."""
    from datetime import datetime
    from PIL import Image
    for v, n in ((reference_name, "name"), (reference_source, "source"), (reference_date, "reference date")):
        if not v or not str(v).strip(): raise ValueError(f"{n} is required: validation must document its independent reference")
    tsf = site_dir / "timeseries.json"
    if not tsf.is_file(): raise ValueError(f"{tsf} not found")
    ts = json.loads(tsf.read_text(encoding="utf-8"))
    pts = [p for p in ts["points"] if p["time"].startswith(sar_date)]
    if len(pts) != 1: raise ValueError(f"SAR date {sar_date} not found; available: {', '.join(p['time'][:10] for p in ts['points'])}")
    pt = pts[0]
    if not pt.get("overlay") or not ts.get("bounds"): raise ValueError("this date has no candidate overlay; re-run the analysis")
    cand = np.asarray(Image.open(site_dir / pt["overlay"]).convert("RGBA"))[..., 3] > 0
    sar_valid = (np.asarray(Image.open(site_dir / pt["image"]).convert("RGBA"))[..., 3] > 0) if pt.get("image") else np.ones(cand.shape, bool)
    w, s, e, n = ts["bounds"]; h, wd = cand.shape
    tf = rasterio.transform.from_bounds(w, s, e, n, wd, h)
    ref, ref_valid, hist = _reference_classes(reference_path, cand.shape, tf, water_values, invalid_min)
    mode = "reference water extent (includes permanent water)"
    if reference_baseline_path:
        ref0, ref0_valid, _ = _reference_classes(reference_baseline_path, cand.shape, tf, water_values, invalid_min)
        ref = ref & ~ref0; ref_valid = ref_valid & ref0_valid
        mode = "new water in the reference (reference date minus reference baseline)"
    valid = sar_valid & ref_valid
    if valid.sum() == 0: raise ValueError("reference does not overlap any valid SAR pixels (check that it covers the site and its CRS is set)")
    m = confusion_metrics(cand, ref, valid)
    gap = abs((datetime.fromisoformat(reference_date) - datetime.fromisoformat(sar_date)).days)
    caveats = [f"Reference and SAR acquisitions are {gap} day(s) apart; flood extent can change within days.",
               "Agreement is with THIS reference only; it has its own errors and blind spots.",
               "Candidates are backscatter decreases; flooded vegetation that brightens is not counted as a candidate."]
    if not reference_baseline_path: caveats.append("No reference baseline was given: permanent rivers and lakes in the reference lower recall.")
    if notes: caveats.append(notes)
    block = {"method": "pixel-wise confusion matrix on the published candidate grid (EPSG:4326, nearest neighbour)",
             "reference": f"{reference_name} - {reference_source}", "referenceDate": reference_date, "sarDate": sar_date, "daysApart": gap,
             "compared": mode, "metrics": m, "referenceCoverageOfSarValid": round(float(valid.sum() / max(sar_valid.sum(), 1)), 6),
             "referenceValues": {str(k): v for k, v in hist.items()}, "waterValues": list(water_values) if water_values else "> 0",
             "caveats": caveats}
    ts["validation"] = block
    tmp = tsf.with_suffix(".json.tmp"); tmp.write_text(json.dumps(ts, indent=2), encoding="utf-8"); tmp.replace(tsf)
    return block
