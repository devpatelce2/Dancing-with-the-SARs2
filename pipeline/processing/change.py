"""Backscatter change detection (flood CANDIDATES, not confirmed floods).

Method (documented in docs/NISAR_DATA_METHOD.md): both acquisitions are terrain-corrected GCOV backscatter in linear power.
After alignment/masking/optional speckle averaging in the LINEAR domain, change = 10*log10(after) - 10*log10(before) [dB].
Open-water flooding typically lowers L-band co-pol backscatter (specular reflection); flooded vegetation can RAISE it
(double bounce). This baseline detects DECREASES only (threshold_db < 0) and states so. No universal threshold exists: it is a
required, recorded parameter. This is NOT displacement and NOT a validated flood map.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
import numpy as np
import rasterio
from rasterio import features
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine, array_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds
from scipy import ndimage as ndi  # noqa: E402

EQUAL_AREA_EPSG = 6933  # NSIDC EASE-Grid 2.0 Global (equal-area), used for km^2


class AlignmentError(ValueError):
    pass


@dataclass(frozen=True)
class ChangeParams:
    threshold_db: float                 # REQUIRED; must be negative for the decrease-based baseline
    speckle_window: int = 3             # odd boxcar size on linear power; 1 = off
    min_mapping_pixels: int = 9         # drop connected components smaller than this
    after_max_db: float | None = None   # optional: also require after-backscatter <= this (open-water style)
    min_valid_power: float = 1e-6       # linear power <= this treated as invalid (<= -60 dB)

    def __post_init__(self):
        if not (self.threshold_db < 0): raise ValueError("threshold_db must be negative (decrease-based baseline)")
        if self.speckle_window < 1 or self.speckle_window % 2 == 0: raise ValueError("speckle_window must be odd >= 1")
        if self.min_mapping_pixels < 1: raise ValueError("min_mapping_pixels must be >= 1")


def crop_to_bbox(data, transform: Affine, epsg: int, bbox_lonlat):
    w, s, e, n = transform_bounds("EPSG:4326", CRS.from_epsg(epsg), *bbox_lonlat, densify_pts=21)
    win = from_bounds(w, s, e, n, transform=transform).round_offsets().round_lengths()
    win = win.intersection(Window(0, 0, data.shape[1], data.shape[0]))  # raises if disjoint
    if win.width < 2 or win.height < 2: raise AlignmentError("AOI covers fewer than 2 pixels of the product")
    r0, c0 = int(win.row_off), int(win.col_off)
    sub = data[r0:r0 + int(win.height), c0:c0 + int(win.width)]
    return sub, transform @ Affine.translation(c0, r0)


def align_to(src, src_tf, src_epsg, dst_shape, dst_tf, dst_epsg):
    """Resample `src` onto the destination grid (bilinear on linear power). Identical grids are passed through untouched."""
    if src_epsg == dst_epsg and src.shape == dst_shape and src_tf.almost_equals(dst_tf, precision=1e-6):
        return src, False
    out = np.full(dst_shape, np.nan, dtype="float32")
    reproject(src, out, src_transform=src_tf, src_crs=CRS.from_epsg(src_epsg), dst_transform=dst_tf, dst_crs=CRS.from_epsg(dst_epsg),
              resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
    return out, True


def nan_boxcar(a: np.ndarray, size: int) -> np.ndarray:
    if size == 1: return a
    valid = np.isfinite(a)
    num = ndi.uniform_filter(np.where(valid, a, 0.0), size=size, mode="nearest")
    den = ndi.uniform_filter(valid.astype("float32"), size=size, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    out[~valid] = np.nan
    return out


def to_db(power: np.ndarray, min_power: float) -> np.ndarray:
    p = np.where(np.isfinite(power) & (power > min_power), power, np.nan)
    with np.errstate(invalid="ignore"):
        return 10.0 * np.log10(p)


def detect(before_pwr, after_pwr, params: ChangeParams, exclude_mask: np.ndarray | None = None):
    """Returns dict(change_db, candidate(bool), valid(bool)). Inputs must already be on the same grid."""
    if before_pwr.shape != after_pwr.shape: raise AlignmentError("before/after shapes differ; align first")
    b = nan_boxcar(before_pwr, params.speckle_window); a = nan_boxcar(after_pwr, params.speckle_window)
    bdb, adb = to_db(b, params.min_valid_power), to_db(a, params.min_valid_power)
    change = (adb - bdb).astype("float32")
    valid = np.isfinite(change)
    if exclude_mask is not None:
        if exclude_mask.shape != change.shape: raise AlignmentError("exclude_mask shape mismatch")
        valid &= ~exclude_mask.astype(bool)
    cand = valid & (change <= params.threshold_db)
    if params.after_max_db is not None: cand &= (adb <= params.after_max_db)
    if params.min_mapping_pixels > 1 and cand.any():
        lab, n = ndi.label(cand)
        sizes = ndi.sum(cand, lab, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, dtype=bool); keep[1:] = sizes >= params.min_mapping_pixels
        cand = keep[lab]
    change = np.where(valid, change, np.nan).astype("float32")
    return {"change_db": change, "candidate": cand, "valid": valid, "before_db": bdb, "after_db": adb}


def polygonize(candidate: np.ndarray, transform: Affine, epsg: int):
    """Vectorise candidates; returns (GeoJSON FeatureCollection in EPSG:4326, total_area_km2).
    Area is computed per polygon in an equal-area CRS (EPSG:6933), never in degrees."""
    from shapely.geometry import shape, mapping
    from shapely.ops import transform as shp_transform
    from pyproj import Transformer
    to4326 = Transformer.from_crs(epsg, 4326, always_xy=True).transform
    to_ea = Transformer.from_crs(epsg, EQUAL_AREA_EPSG, always_xy=True).transform
    feats, total = [], 0.0
    for geom, val in features.shapes(candidate.astype("uint8"), mask=candidate, transform=transform):
        if val != 1: continue
        g = shape(geom)
        km2 = shp_transform(to_ea, g).area / 1e6
        total += km2
        feats.append({"type": "Feature", "geometry": mapping(shp_transform(to4326, g)),
                      "properties": {"areaKm2": round(km2, 6), "class": "flood-candidate"}})
    return {"type": "FeatureCollection", "features": feats}, total


def pixel_area_km2(transform: Affine, epsg: int, shape) -> float:
    """Mean pixel area (km^2) in the equal-area CRS, from the AOI centre pixel."""
    from pyproj import Transformer
    r, c = shape[0] // 2, shape[1] // 2
    t = Transformer.from_crs(epsg, EQUAL_AREA_EPSG, always_xy=True).transform
    pts = [transform * (c + dc, r + dr) for dc, dr in ((0, 0), (1, 0), (1, 1), (0, 1))]
    q = [t(*p) for p in pts]
    x, y = zip(*q)
    return abs(0.5 * sum(x[i] * y[(i + 1) % 4] - x[(i + 1) % 4] * y[i] for i in range(4))) / 1e6


def candidate_area_km2(candidate: np.ndarray, transform: Affine, epsg: int) -> float:
    """Exact sum of candidate polygon areas in the equal-area CRS (preferred over count*pixel area)."""
    return polygonize(candidate, transform, epsg)[1]


def load_exclude_mask(path: str, dst_shape, dst_tf: Affine, dst_epsg: int) -> np.ndarray:
    """Binary exclusion raster (e.g. permanent water, steep slope) -> boolean mask on the analysis grid.
    Any non-zero, non-nodata pixel is EXCLUDED. Pixels outside the mask raster's extent are NOT excluded (reported by caller)."""
    with rasterio.open(path) as src:
        if src.crs is None: raise AlignmentError(f"mask '{Path(path).name}' has no CRS")
        out = np.zeros(dst_shape, dtype="float32")
        reproject(rasterio.band(src, 1), out, dst_transform=dst_tf, dst_crs=CRS.from_epsg(dst_epsg),
                  resampling=Resampling.nearest, src_nodata=src.nodata, dst_nodata=0)
    return out > 0

