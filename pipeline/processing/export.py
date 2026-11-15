"""Write the stable per-site output contract. GeoTIFFs are the scientific source; PNGs are visualisation only."""
from __future__ import annotations
import json, platform
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject

SCHEMA_VERSION = 1
LIMITATIONS = [
    "Flood CANDIDATES from a backscatter-decrease baseline; not confirmed floods and not independently validated unless meta.validation says so.",
    "Decrease-only method: flooded vegetation (double-bounce, backscatter increase) is not detected.",
    "Backscatter also changes with soil moisture, vegetation/crop phenology, wind roughening, harvest or tillage and snow; these can cause false alarms or omissions.",
    "Threshold is an analyst-chosen parameter, not a universal constant; results depend on it.",
    "Terrain effects (layover, shadow, steep slopes) can mimic or hide change; no slope mask is applied unless listed in meta.processing.masks.",
    "Backscatter change is not ground displacement and must not be interpreted as such.",
]


def write_geotiff(path: Path, arr: np.ndarray, transform, epsg: int, nodata=np.nan, dtype="float32"):
    prof = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=dtype, crs=CRS.from_epsg(epsg),
                transform=transform, nodata=nodata, compress="deflate", tiled=True, blockxsize=256, blockysize=256)
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(arr.astype(dtype), 1)


def _to_4326(arr, transform, epsg, categorical=False):
    dst_tf, w, h = calculate_default_transform(CRS.from_epsg(epsg), CRS.from_epsg(4326), arr.shape[1], arr.shape[0],
                                               *rasterio.transform.array_bounds(arr.shape[0], arr.shape[1], transform))
    out = np.full((h, w), np.nan, dtype="float32")
    reproject(arr.astype("float32"), out, src_transform=transform, src_crs=CRS.from_epsg(epsg), dst_transform=dst_tf,
              dst_crs=CRS.from_epsg(4326), resampling=Resampling.nearest if categorical else Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan)
    b = rasterio.transform.array_bounds(h, w, dst_tf)  # (W,S,E,N)
    return out, [float(b[0]), float(b[1]), float(b[2]), float(b[3])]


def _gray_png(path: Path, db4326: np.ndarray, lo: float, hi: float):
    valid = np.isfinite(db4326)
    g = np.clip((np.nan_to_num(db4326, nan=lo) - lo) / (hi - lo), 0, 1)
    rgba = np.zeros(db4326.shape + (4,), dtype="uint8")
    # cyan/blue radar ramp
    rgba[..., 0] = (g * 120).astype("uint8"); rgba[..., 1] = (40 + g * 215).astype("uint8"); rgba[..., 2] = (90 + g * 165).astype("uint8")
    rgba[..., 3] = np.where(valid, 255, 0).astype("uint8")
    Image.fromarray(rgba, "RGBA").save(path)


def _true_gray_png(path: Path, db4326: np.ndarray, lo: float, hi: float):
    """Neutral grey radar image (dark = low backscatter), transparent where there is no data."""
    valid = np.isfinite(db4326)
    g = (np.clip((np.nan_to_num(db4326, nan=lo) - lo) / (hi - lo), 0, 1) * 255).astype("uint8")
    rgba = np.dstack([g, g, g, np.where(valid, 255, 0).astype("uint8")])
    Image.fromarray(rgba, "RGBA").save(path)


def _change_png(path: Path, cand4326: np.ndarray):
    rgba = np.zeros(cand4326.shape + (4,), dtype="uint8")
    m = cand4326 > 0.5
    rgba[m] = (255, 90, 60, 200)   # flood-candidate (decrease) colour; legend in UI
    Image.fromarray(rgba, "RGBA").save(path)


def export_site(out_dir: Path, *, site: dict, before, after, result: dict, transform, epsg: int, params, polygons: dict, area_km2: float,
                align_resampled: bool, notes: list[str], validation: dict | None = None, masks: list[str] | None = None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    cand = result["candidate"]
    write_geotiff(out_dir / "before.tif", result["before_db"], transform, epsg)
    write_geotiff(out_dir / "after.tif", result["after_db"], transform, epsg)
    write_geotiff(out_dir / "change.tif", result["change_db"], transform, epsg)
    write_geotiff(out_dir / "candidate.tif", cand.astype("uint8"), transform, epsg, nodata=None, dtype="uint8")

    b4326, bounds = _to_4326(result["before_db"], transform, epsg)
    a4326, _ = _to_4326(result["after_db"], transform, epsg)
    c4326, _ = _to_4326(cand.astype("float32"), transform, epsg, categorical=True)
    both = np.concatenate([b4326[np.isfinite(b4326)], a4326[np.isfinite(a4326)]])
    if both.size == 0: raise ValueError("No valid pixels in AOI after masking; nothing to export")
    lo, hi = (float(np.percentile(both, 2)), float(np.percentile(both, 98)))
    if hi <= lo: hi = lo + 1.0
    _gray_png(out_dir / "before.png", b4326, lo, hi); _gray_png(out_dir / "after.png", a4326, lo, hi); _change_png(out_dir / "change.png", c4326)
    (out_dir / "change.geojson").write_text(json.dumps(polygons), encoding="utf-8")

    import numpy, rasterio as rio, h5py, shapely, pyproj
    px_km2 = float(abs(transform.a * transform.e)) / 1e6 if epsg != 4326 else None
    valid = result["valid"]
    meta = {
        "schemaVersion": SCHEMA_VERSION, "siteId": site["siteId"], "name": site.get("name", site["siteId"]), "eventName": site["eventName"],
        "country": site.get("country"), "mission": "NISAR", "productType": "GCOV",
        "bounds": bounds, "crs": "EPSG:4326", "processingCrs": f"EPSG:{epsg}", "pixelSizeProcessingCrs": [abs(transform.a), abs(transform.e)],
        "aoi": site.get("aoi"),
        "before": {"productId": before["productId"], "acquisitionTime": before["acquisitionTime"], "polarization": before["polarization"], "frequency": before.get("frequency")},
        "after": {"productId": after["productId"], "acquisitionTime": after["acquisitionTime"], "polarization": after["polarization"], "frequency": after.get("frequency")},
        "stats": {"affectedAreaKm2": round(float(area_km2), 6), "changedPixels": int(cand.sum()), "polygonCount": len(polygons["features"]),
                  "validPixels": int(valid.sum()), "totalPixels": int(valid.size), "validCoverage": round(float(valid.mean()), 6),
                  "areaMethod": f"per-polygon area in equal-area EPSG:{6933}"},
        "method": {"name": "log-ratio backscatter decrease (flood candidates)", "thresholdDb": params.threshold_db,
                   "speckleWindow": params.speckle_window, "minMappingPixels": params.min_mapping_pixels, "afterMaxDb": params.after_max_db,
                   "minValidPower": params.min_valid_power, "thresholdSelection": site.get("thresholdSelection", "analyst-specified; see docs/NISAR_DATA_METHOD.md")},
        "calibration": {"input": "NISAR GCOV terrain-corrected backscatter, linear power as stored", "unitsAttribute": before.get("units"),
                        "note": "Radiometric terms are used as stored in the product; no extra calibration applied by this pipeline."},
        "quality": {"alignmentResampled": align_resampled, "operatorNotes": notes, "visualisationStretchDb": [round(lo, 3), round(hi, 3)]},
        "processing": {"masks": masks or [], "processedAt": datetime.now(timezone.utc).isoformat(),
                       "software": {"python": platform.python_version(), "numpy": numpy.__version__, "rasterio": rio.__version__,
                                    "h5py": h5py.__version__, "shapely": shapely.__version__, "pyproj": pyproj.__version__}},
        "validation": validation,
        "limitations": LIMITATIONS,
        "files": {"before": "before.png", "after": "after.png", "change": "change.png", "polygons": "change.geojson",
                  "rasters": ["before.tif", "after.tif", "change.tif", "candidate.tif"]},
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def update_sites_index(data_dir: Path, site_id: str, name: str):
    """Kept for callers; the index is rebuilt from the folders so no site can be dropped or duplicated."""
    from ..rebuild_index import rebuild
    rebuild(data_dir)
