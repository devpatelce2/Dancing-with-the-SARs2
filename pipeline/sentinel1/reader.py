"""Reader for OPERA RTC-S1 GeoTIFFs (Sentinel-1, terrain-corrected gamma0 backscatter in LINEAR power, 30 m).

One "scene" is one pass: a string of one or more burst file paths/URLs separated by whitespace (see sentinel1.catalog).
For each burst the AOI window is read, the layover/shadow/invalid mask layer is applied when it exists next to the data, and the bursts
are mosaicked onto one grid in the first burst's UTM zone (aligned to that burst's pixel grid, nearest neighbour; where bursts overlap
the first valid value is kept). Returns the same GcovLayer record the NISAR reader returns, so everything downstream is shared.

Remote files are downloaded whole (a burst GeoTIFF is small) into a cache folder with the token-safe Earthdata session used for NISAR:
env S1_CACHE_DIR (default ./.cache/sentinel1). Downloads are never repeated. Local paths work too.
NOT VERIFIED against live NASA servers in the authoring environment (no network); verified on synthetic GeoTIFFs written in the same layout.
"""
from __future__ import annotations
import os, re, sys
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.errors import WindowError
from rasterio.transform import Affine
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from ..nisar.download import DownloadError, download_granule
from ..nisar.gcov_reader import GcovFormatError, GcovLayer
from ..nisar.remote import is_url
from .catalog import FILE_SUFFIX, NAME_RE

MASK_MIN_VALID = 0.05  # if the mask would leave less than this share of valid pixels, it is ignored (and that is reported)


def cache_dir() -> Path:
    return Path(os.environ.get("S1_CACHE_DIR", ".cache/sentinel1"))


def _local(src: str, notes: list[str], *, optional: bool = False) -> Path | None:
    """Local path for a file path or https URL (downloading + caching URLs)."""
    if not is_url(src):
        p = Path(src)
        if p.is_file(): return p
        if optional: return None
        raise GcovFormatError(f"file not found: {src}")
    name = urlparse(src).path.rsplit("/", 1)[-1]
    try:
        p = download_granule(src, cache_dir(), name)
    except DownloadError as e:
        if optional and "not found" in str(e): return None
        raise GcovFormatError(f"{name}: {e}") from e
    notes.append(f"{name}: {p.stat().st_size / 1e6:.0f} MB (cached in {cache_dir()})")
    return p


def _mask_source(src: str) -> str:
    return FILE_SUFFIX.sub("_mask.tif", src) if FILE_SUFFIX.search(src) else src + "_mask.tif"


def _read_burst(src: str, bbox, notes: list[str], use_mask: bool):
    """-> (window array float32 with NaN holes, window transform, epsg)"""
    p = _local(src, notes)
    with rasterio.open(p) as ds:
        if ds.crs is None or ds.crs.to_epsg() is None:
            raise GcovFormatError(f"{p.name}: no EPSG code in the GeoTIFF")
        epsg = ds.crs.to_epsg()
        w, s, e, n = transform_bounds("EPSG:4326", ds.crs, *bbox, densify_pts=21)
        pad = 2 * abs(ds.transform.a)
        win = from_bounds(w - pad, s - pad, e + pad, n + pad, transform=ds.transform).round_offsets().round_lengths()
        try:
            win = win.intersection(Window(0, 0, ds.width, ds.height))
        except WindowError:
            return None  # this burst does not touch the box
        if win.width < 2 or win.height < 2:
            return None
        shape = (ds.height, ds.width)
        arr = ds.read(1, window=win).astype("float32")
        if ds.nodata is not None and np.isfinite(ds.nodata): arr[arr == ds.nodata] = np.nan
        arr[~np.isfinite(arr)] = np.nan
        wtf = ds.window_transform(win)
    neg = np.isfinite(arr) & (arr < 0)
    if np.isfinite(arr).any() and neg.sum() > 0.01 * np.isfinite(arr).sum():
        raise GcovFormatError(f"{Path(p).name}: many negative values; this looks like dB, not linear power. Only linear gamma0 (OPERA RTC-S1 default) is supported")
    arr[arr <= 0] = np.nan
    if use_mask:
        mp = _local(_mask_source(src), notes, optional=True)
        if mp is None:
            notes.append(f"{Path(p).name}: no mask layer found; layover/shadow NOT excluded")
        else:
            with rasterio.open(mp) as md:
                if (md.height, md.width) == shape:
                    m = md.read(1, window=win)
                    ok = (m == 0)  # 0 = valid; 1 shadow, 2 layover, 3 both, 255 invalid (OPERA convention as understood by the authors)
                    if np.isfinite(arr).any() and (ok & np.isfinite(arr)).sum() < MASK_MIN_VALID * np.isfinite(arr).sum():
                        notes.append(f"{Path(p).name}: mask would remove >{100 - 100 * MASK_MIN_VALID:.0f}% of pixels; mask ignored (check its value convention)")
                    else:
                        arr[~ok] = np.nan
                else:
                    notes.append(f"{Path(p).name}: mask grid differs from data grid; mask ignored")
    return arr, wtf, epsg


def _block_mean(a: np.ndarray, n: int) -> np.ndarray:
    nr, nc = a.shape[0] // n, a.shape[1] // n
    if nr < 1 or nc < 1: raise GcovFormatError(f"Window {a.shape} px is smaller than the block size {n}; lower the downsample factor")
    b = a[:nr * n, :nc * n].reshape(nr, n, nc, n)
    valid = np.isfinite(b)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(valid, b, 0.0).sum(axis=(1, 3), dtype="float64") / valid.sum(axis=(1, 3))
    out[valid.sum(axis=(1, 3)) < 0.5 * n * n] = np.nan
    return out.astype("float32")


def read_rtc_scene(src: str, polarization: str = "VV", bbox_lonlat=None, downsample: int = 1, use_mask: bool = True) -> GcovLayer:
    if bbox_lonlat is None: raise ValueError("bbox_lonlat is required (bursts are cropped to the box)")
    if int(downsample) != downsample or downsample < 1: raise ValueError("downsample must be an integer >= 1")
    downsample = int(downsample)
    notes: list[str] = []
    paths = str(src).split()
    if not paths: raise GcovFormatError("empty scene")
    tiles = []
    for k, p in enumerate(paths, 1):
        sys.stderr.write(f"\r  burst {k}/{len(paths)}                              "); sys.stderr.flush()
        t = _read_burst(p, bbox_lonlat, notes, use_mask)
        if t is not None: tiles.append(t)
    sys.stderr.write("\n")
    if not tiles:
        raise GcovFormatError("The area of interest does not overlap any burst of this pass. Move the box or pick another track.")
    # target grid: the box in the first tile's CRS, snapped to that tile's pixel grid
    arr0, tf0, epsg = tiles[0]
    dx, dy = tf0.a, tf0.e
    w, s, e, n = transform_bounds("EPSG:4326", CRS.from_epsg(epsg), *bbox_lonlat, densify_pts=21)
    x0 = tf0.c + np.floor((w - tf0.c) / dx) * dx
    y0 = tf0.f + np.ceil((n - tf0.f) / dy) * dy
    ncol = int(np.ceil((e - x0) / dx)); nrow = int(np.ceil((s - y0) / dy))
    if ncol < 2 or nrow < 2: raise GcovFormatError("AOI covers fewer than 2 pixels of the product")
    tf = Affine(dx, 0.0, x0, 0.0, dy, y0)
    out = np.full((nrow, ncol), np.nan, dtype="float32")
    for arr, wtf, ep in tiles:
        layer = np.full((nrow, ncol), np.nan, dtype="float32")
        reproject(arr, layer, src_transform=wtf, src_crs=CRS.from_epsg(ep), dst_transform=tf, dst_crs=CRS.from_epsg(epsg),
                  resampling=Resampling.nearest, src_nodata=np.nan, dst_nodata=np.nan)
        fill = ~np.isfinite(out) & np.isfinite(layer)
        out[fill] = layer[fill]
        if ep != epsg: notes.append(f"a burst in EPSG:{ep} was resampled (nearest) onto EPSG:{epsg}")
    cover = float(np.isfinite(out).mean())
    notes.append(f"mosaic of {len(tiles)} burst(s); {100 * cover:.0f}% of the box has valid backscatter")
    if cover < 0.5:
        raise GcovFormatError(f"Only {100 * cover:.0f}% of the box has valid data in this pass; bursts do not cover the box. Move the box or pick another track.")
    if downsample > 1:
        out = _block_mean(out, downsample)
        tf = Affine(dx * downsample, 0.0, x0, 0.0, dy * downsample, y0)
        notes.append(f"{downsample}x{downsample} block mean of linear power over valid pixels (pixel {abs(dx * downsample):g} m)")
    m = NAME_RE.search(paths[0].split("?")[0].replace("\\", "/").rsplit("/", 1)[-1])
    when = None
    if m:
        from datetime import datetime, timezone
        when = datetime.strptime(m["acq"], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).isoformat()
    return GcovLayer(out, tf, int(epsg), polarization, "C-band", when, None, "gamma0 linear power (OPERA RTC-S1)", paths[0], notes)
