"""Reader for NISAR L2 GCOV HDF5 backscatter layers.

HONESTY NOTE: dataset names below (grids/frequency*/<pol-term>, xCoordinates, yCoordinates, projection, zeroDopplerStartTime)
come from the NISAR product specification as understood by the authors and are NOT yet verified against a downloaded file in
this repository's authoring environment. The reader therefore DISCOVERS layers by name and fails with `GcovFormatError`
(including a structure listing) when anything required is missing or ambiguous. Run
`python -m pipeline.nisar.hdf5_inspect <file>` on a real granule and compare. Never silently guess.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
import h5py
import numpy as np
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.warp import transform_bounds
from .remote import open_h5

POL_TERM = re.compile(r"^(HH|VV|HV|VH|RH|RV)(HH|VV|HV|VH|RH|RV)$")  # diagonal terms (e.g. HHHH) are real power layers


class GcovFormatError(ValueError):
    pass


@dataclass
class GcovLayer:
    data: np.ndarray            # float32, linear power as stored (NaN where non-finite)
    transform: Affine
    epsg: int
    polarization: str           # e.g. 'HHHH'
    frequency: str              # e.g. 'frequencyA'
    start_time: str | None
    nodata_attr: float | None
    units_attr: str | None
    source_path: str
    notes: list[str] = field(default_factory=list)  # anything inferred/overridden, surfaced into meta.json


def _decode(v):
    if isinstance(v, bytes): return v.decode("utf-8", "replace")
    if isinstance(v, np.ndarray) and v.shape == (): return _decode(v.item())
    return v


def _find_datasets(f: h5py.File, predicate) -> list[str]:
    hits: list[str] = []
    f.visititems(lambda n, o: hits.append(n) if isinstance(o, h5py.Dataset) and predicate(n, o) else None)
    return hits


def _structure_hint(f: h5py.File, limit=40) -> str:
    names: list[str] = []
    f.visit(lambda n: names.append(n))
    return "; ".join(names[:limit])


def available_layers(src) -> list[tuple[str, str, str]]:
    """[(dataset_path, frequency, pol_term)] for every grid-like diagonal backscatter layer found. `src`: path, URL or open h5py.File."""
    def _scan(f):
        out = []
        for n in _find_datasets(f, lambda n, o: POL_TERM.match(n.rsplit("/", 1)[-1]) is not None and o.ndim == 2):
            m = re.search(r"(frequency[A-Z])", n)
            out.append((n, m.group(1) if m else "unknown", n.rsplit("/", 1)[-1]))
        return out
    if isinstance(src, h5py.File): return _scan(src)
    with open_h5(src) as (f, _):
        return _scan(f)


import sys as _sys, time as _time
PROGRESS_LABEL = ""  # set by callers to name the scene being read


def _progress(done, total, t0):
    el = _time.time() - t0
    eta = el / done * (total - done) if done else 0
    _sys.stderr.write(f"\r  {PROGRESS_LABEL} {100 * done / total:5.1f}%  elapsed {el:5.0f}s  ~{eta:5.0f}s left   ")
    _sys.stderr.flush()
    if done >= total: _sys.stderr.write("\n")


STRIP_ROWS = 1024  # rows read per HDF5 request when block-averaging; keeps memory small on 34000 x 34000 grids


def _block_mean(ds, mask_ds, r0, r1, c0, c1, n, nodata):
    """Windowed read + n x n block mean of LINEAR power over VALID pixels only (NaN-aware), strip by strip.
    Blocks with < 50% valid pixels become NaN. Returns float32 array of shape ((r1-r0)//n, (c1-c0)//n)."""
    nr, nc = (r1 - r0) // n, (c1 - c0) // n
    if nr < 1 or nc < 1:
        raise GcovFormatError(f"Window {(r1 - r0, c1 - c0)} px is smaller than the block size {n}; lower the downsample factor")
    out = np.full((nr, nc), np.nan, dtype="float32")
    step = max(1, STRIP_ROWS // n) * n
    t0 = _time.time()
    for a in range(0, nr * n, step):
        b = min(a + step, nr * n)
        blk = np.asarray(ds[r0 + a:r0 + b, c0:c0 + nc * n], dtype="float32")
        if nodata is not None: blk[blk == nodata] = np.nan
        valid = np.isfinite(blk)
        if mask_ds is not None:
            m = mask_ds[r0 + a:r0 + b, c0:c0 + nc * n]
            valid &= ~((m == 0) | (m == 255))
        blk = np.where(valid, blk, 0.0).astype("float32")
        h = (b - a) // n
        ssum = blk.reshape(h, n, nc, n).sum(axis=(1, 3), dtype="float64")
        cnt = valid.reshape(h, n, nc, n).sum(axis=(1, 3))
        with np.errstate(invalid="ignore", divide="ignore"):
            res = ssum / cnt
        res[cnt < 0.5 * n * n] = np.nan
        out[a // n:a // n + h] = res.astype("float32")
        _progress(b, nr * n, t0)
    return out


def read_layer(path: str, polarization: str | None = None, frequency: str | None = None,
               epsg_override: int | None = None, time_override: str | None = None,
               bbox_lonlat=None, downsample: int = 1) -> GcovLayer:
    """bbox_lonlat=(W,S,E,N): read ONLY that window (real GCOV grids are ~34000 x 34000 px = 4.7 GB per layer).
    downsample=n: n x n block mean in linear power (also reduces speckle). The valid-samples `mask` layer, when present
    next to the data, is applied (0 = partially focused/invalid, 255 = outside acquisition)."""
    notes: list[str] = []
    if downsample < 1 or int(downsample) != downsample: raise ValueError("downsample must be an integer >= 1")
    downsample = int(downsample)
    with open_h5(path) as (f, remote):
        cands = [(n, fr, p) for n, fr, p in available_layers(f)
                 if (polarization is None or p == polarization) and (frequency is None or fr == frequency)]
        if not cands:
            raise GcovFormatError(f"No matching backscatter layer found. Structure: {_structure_hint(f)}")
        if len(cands) > 1 and polarization is None:
            raise GcovFormatError("Multiple layers present; choose one explicitly with polarization= / frequency=: "
                                  + ", ".join(f"{fr}/{p}" for _, fr, p in cands))
        if len(cands) > 1:
            raise GcovFormatError("Ambiguous layer selection; also pass frequency=: " + ", ".join(f"{fr}/{p}" for _, fr, p in cands))
        ds_path, fr, pol = cands[0]
        ds = f[ds_path]
        grp = ds.parent
        xs = [n for n in ("xCoordinates", "yCoordinates") if n not in grp]
        if xs:
            raise GcovFormatError(f"Missing {xs} next to {ds_path}. Structure: {_structure_hint(f)}")
        x = np.asarray(grp["xCoordinates"][...], dtype="float64"); y = np.asarray(grp["yCoordinates"][...], dtype="float64")
        if ds.shape != (y.size, x.size):
            raise GcovFormatError(f"Layer shape {ds.shape} does not match coordinate vectors ({y.size}, {x.size})")
        if x.size < 2 or y.size < 2:
            raise GcovFormatError("Coordinate vectors too short")
        dx, dy = np.diff(x), np.diff(y)
        if not (np.allclose(dx, dx[0], rtol=1e-6) and np.allclose(dy, dy[0], rtol=1e-6)):
            raise GcovFormatError("Coordinates are not regularly spaced; refusing to build an affine transform")
        dxs, dys = float(dx[0]), float(dy[0])
        if dxs <= 0: raise GcovFormatError("x coordinates must increase")

        epsg = epsg_override
        if epsg is None:
            for pn in _find_datasets(f, lambda n, o: n.rsplit("/", 1)[-1] == "projection"):
                for k, v in f[pn].attrs.items():
                    if "epsg" in k.lower():
                        try: epsg = int(_decode(v)); break
                        except (TypeError, ValueError): pass
                if epsg is None:
                    try: epsg = int(f[pn][()])
                    except (TypeError, ValueError): pass
                if epsg: break
        else:
            notes.append(f"EPSG {epsg} supplied by operator, not read from file")
        if not epsg:
            raise GcovFormatError("Could not determine EPSG code from the file; pass epsg_override after checking the product. "
                                  f"Structure: {_structure_hint(f)}")

        t = time_override
        if t is None:
            hits = _find_datasets(f, lambda n, o: n.rsplit("/", 1)[-1] == "zeroDopplerStartTime")
            if hits: t = str(_decode(f[hits[0]][()]))
        else:
            notes.append("acquisition time supplied by operator (e.g. from catalogue), not read from file")

        nodata = ds.attrs.get("_FillValue", None)
        nodata = float(_decode(np.asarray(nodata).ravel()[0])) if nodata is not None else None
        units = _decode(ds.attrs.get("units")) if "units" in ds.attrs else None
        mask_ds = grp["mask"] if ("mask" in grp and grp["mask"].shape == ds.shape) else None

        r0, r1, c0, c1 = 0, y.size, 0, x.size
        if bbox_lonlat is not None:
            w, s_, e, n_ = transform_bounds("EPSG:4326", CRS.from_epsg(int(epsg)), *bbox_lonlat, densify_pts=21)
            padx, pady = 2 * dxs, 2 * abs(dys)
            rows = np.where((y >= s_ - pady) & (y <= n_ + pady))[0]
            cols = np.where((x >= w - padx) & (x <= e + padx))[0]
            if rows.size == 0 or cols.size == 0:
                sw = transform_bounds(CRS.from_epsg(int(epsg)), "EPSG:4326", float(x.min()), float(y.min()), float(x.max()), float(y.max()), densify_pts=21)
                raise GcovFormatError("The area of interest does not overlap this scene. Scene covers lon/lat "
                                      f"W,S,E,N = {sw[0]:.3f}, {sw[1]:.3f}, {sw[2]:.3f}, {sw[3]:.3f}; requested {tuple(round(v, 3) for v in bbox_lonlat)}. "
                                      "Pick another track/frame or move the box.")
            r0, r1, c0, c1 = int(rows.min()), int(rows.max()) + 1, int(cols.min()), int(cols.max()) + 1
            notes.append(f"read window rows {r0}:{r1}, cols {c0}:{c1} of {ds.shape[0]}x{ds.shape[1]} (AOI only)")

        if downsample > 1:
            arr = _block_mean(ds, mask_ds, r0, r1, c0, c1, downsample, nodata)
            nr, nc = arr.shape
            x = x[c0:c0 + nc * downsample].reshape(nc, downsample).mean(axis=1)
            y = y[r0:r0 + nr * downsample].reshape(nr, downsample).mean(axis=1)
            dxs, dys = dxs * downsample, dys * downsample
            notes.append(f"{downsample}x{downsample} block mean of linear power over valid pixels (pixel {abs(dxs):g} m)")
        else:
            arr = np.asarray(ds[r0:r1, c0:c1], dtype="float32")
            x, y = x[c0:c1], y[r0:r1]
            if nodata is not None: arr[arr == nodata] = np.nan
            if mask_ds is not None:
                m = mask_ds[r0:r1, c0:c1]; arr[(m == 0) | (m == 255)] = np.nan
        if mask_ds is not None: notes.append("valid-samples mask applied (0 and 255 excluded)")
        arr[~np.isfinite(arr)] = np.nan
        # Orient north-up (y descending)
        if dys > 0:
            arr = arr[::-1, :]; y = y[::-1]; dys = -dys; notes.append("rows flipped to north-up")
        transform = Affine(dxs, 0.0, x[0] - dxs / 2, 0.0, dys, y[0] - dys / 2)
        if remote is not None: notes.append(remote.describe())
        return GcovLayer(arr, transform, int(epsg), pol, fr, t, nodata, units if units is None else str(units), str(path), notes)
