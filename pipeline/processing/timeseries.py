"""Time-series surface-change analysis over a stack of NISAR GCOV scenes (same track / direction / frame / polarization).

For every acquisition we (1) crop to the AOI, (2) average speckle in LINEAR power, (3) convert to dB, then report
  * mean backscatter of the AOI (mean of linear power -> dB), median dB, valid-pixel coverage
  * change versus a per-pixel BASELINE (median dB of the baseline scenes): delta of the AOI mean, per-pixel candidate mask,
    changed area in km^2 (equal-area CRS) and as % of valid area
  * z-score of the AOI mean against the baseline scenes (only when >= 3 baseline scenes)
and over the whole series a Mann-Kendall trend test and Sen's slope.

Same honesty rules as change.py: output pixels are CHANGE CANDIDATES, not confirmed events; the threshold is an analyst-chosen,
recorded parameter; decreases only (open-water style). Nothing here is displacement.
"""
from __future__ import annotations
import json, re
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
import numpy as np
from scipy import stats as sps
from ..nisar.gcov_reader import read_layer, GcovFormatError
from . import change as ch
from . import export as ex

S1_NAME_RE = re.compile(r"OPERA_L2_RTC-S1_T(?P<track>\d{3})-\d{6}-IW[123]_(?P<acq>\d{8}T\d{6})Z_")
NAME_RE = re.compile(r"_GCOV_(?P<cycle>\d{3})_(?P<track>\d{3})_(?P<dir>[AD])_(?P<frame>\d{3})_")
TIME_RE = re.compile(r"_(\d{8}T\d{6})_(\d{8}T\d{6})_")

S1_LIMITATIONS = [
    "Sentinel-1 is C-band: its signal reflects mostly off the canopy top, so flooding under dense vegetation is much less visible than with L-band (NISAR).",
    "Sentinel-1 data here are OPERA RTC-S1 (30 m, terrain-corrected gamma0). Where the product's mask layer was available, layover/shadow and invalid pixels were excluded; otherwise radar shadow can look like water.",
]

LIMITATIONS = ex.LIMITATIONS + [
    "Time-series statistics describe the AOI as a whole; a mixed AOI (land, water, crops) can hide or exaggerate local change.",
    "Trend tests need enough scenes (>= 4) and assume roughly evenly spaced acquisitions; they do not prove a physical cause.",
]


def _base(f) -> str:
    """File name of a local path or URL, on any OS. A Sentinel-1 scene may list several burst files; the first one names the scene."""
    first = (str(f).split() or [""])[0]
    return re.split(r"[\\/]", first.split("?")[0])[-1]


def detect_mission(files) -> str:
    return "SENTINEL-1" if files and all("RTC-S1" in _base(f) for f in files) else "NISAR"


def parse_scene_name(path: str) -> dict:
    n = _base(path)
    sm = S1_NAME_RE.search(n)
    if sm:  # Sentinel-1 (OPERA RTC-S1): track from the burst ID; direction/frame are not in the name
        return {"cycle": None, "track": sm["track"], "direction": None, "frame": None,
                "startUtc": datetime.strptime(sm["acq"], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).isoformat()}
    m = NAME_RE.search(n)
    t = TIME_RE.search(n)
    return {
        "cycle": m["cycle"] if m else None, "track": m["track"] if m else None,
        "direction": m["dir"] if m else None, "frame": m["frame"] if m else None,
        "startUtc": datetime.strptime(t[1], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).isoformat() if t else None,
    }


def _iso_from_file(s: str | None) -> str | None:
    if not s: return None
    s = re.sub(r"(\.\d{6})\d+", r"\1", str(s).strip())
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None: d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat()


def mann_kendall(y: np.ndarray):
    """Two-sided Mann-Kendall with tie correction (normal approximation). Returns dict or None when n < 4."""
    y = np.asarray(y, dtype="float64"); n = y.size
    if n < 4: return None
    s = 0.0
    for i in range(n - 1): s += np.sign(y[i + 1:] - y[i]).sum()
    _, counts = np.unique(y, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - np.sum(counts * (counts - 1) * (2 * counts + 5))) / 18.0
    if var <= 0: return None
    z = (s - np.sign(s)) / np.sqrt(var) if s != 0 else 0.0
    p = 2 * (1 - sps.norm.cdf(abs(z)))
    return {"S": float(s), "z": float(z), "p": float(p), "tau": float(s / (n * (n - 1) / 2))}


def sen_slope(t_days: np.ndarray, y: np.ndarray):
    t = np.asarray(t_days, dtype="float64"); y = np.asarray(y, dtype="float64")
    if t.size < 2: return None
    sl = [(y[j] - y[i]) / (t[j] - t[i]) for i, j in combinations(range(t.size), 2) if t[j] != t[i]]
    return float(np.median(sl)) if sl else None


def _mean_db(power: np.ndarray, min_power: float):
    v = power[np.isfinite(power) & (power > min_power)]
    if v.size == 0: return None, None, 0
    return float(10 * np.log10(v.mean())), float(np.median(10 * np.log10(v))), int(v.size)


def dedupe_acquisitions(files):
    """ASF can list several products for ONE satellite pass (different processing versions of the same acquisition). Using both
    would count that date twice in the baseline, the chart and the statistics. Keep one per acquisition start time: the product
    whose file name sorts last (the higher processing version). Files whose time cannot be read from the name are all kept."""
    best: dict = {}; keep_unknown = []
    for f in files:
        i = parse_scene_name(f); key = (i["track"], i["direction"], i["frame"], i["startUtc"])
        if not i["startUtc"]: keep_unknown.append(f); continue
        if key not in best or _base(f) > _base(best[key]): best[key] = f
    kept = set(best.values()) | set(keep_unknown)
    return [f for f in files if f in kept], [f for f in files if f not in kept]


def build_timeseries(*, files, bbox, polarization, threshold_db, out_root: Path, site: dict, frequency=None, epsg_override=None,
                     event_date: str | None = None, baseline_n: int = 3, speckle_window: int = 3, min_pixels: int = 9,
                     allow_mixed_tracks: bool = False, downsample: int | None = None, write_overlays: bool = True, exclude_masks=(), synthetic: bool = False,
                     mission: str | None = None) -> dict:
    if len(files) < 3: raise ValueError("Need at least 3 scenes for a time series (8-10 recommended)")
    mission = mission or detect_mission(files)
    if mission not in ("NISAR", "SENTINEL-1"): raise ValueError("mission must be NISAR or SENTINEL-1")
    s1 = mission == "SENTINEL-1"
    if downsample is None: downsample = 1 if s1 else 8  # Sentinel-1 RTC is already 30 m; NISAR GCOV is ~10 m
    params = ch.ChangeParams(threshold_db, speckle_window, min_pixels)
    dropped: list[str] = []
    if not s1:
        files, dropped = dedupe_acquisitions(files)
        if len(files) < 3:
            raise ValueError(f"Only {len(files)} distinct acquisition dates after removing {len(dropped)} duplicate product(s) of the same pass; need at least 3")
    infos = [parse_scene_name(f) for f in files]
    keys = {(i["track"], i["direction"], i["frame"]) for i in infos}
    if len(keys) > 1 and not allow_mixed_tracks:
        raise ValueError("Scenes come from different track/direction/frame combinations "
                         f"{sorted(keys, key=str)}; a time series must use ONE. Pass allow_mixed_tracks=True only if you know why.")

    scenes = []
    notes: list[str] = [f"{_base(d)}: skipped, another product of the same satellite pass is already used" for d in dropped]
    ref = None
    from ..nisar import gcov_reader as _gr
    for k, (f, info) in enumerate(zip(files, infos), 1):
        _gr.PROGRESS_LABEL = f"scene {k}/{len(files)}"
        if s1:
            from ..sentinel1.reader import read_rtc_scene
            L = read_rtc_scene(f, polarization, bbox_lonlat=bbox, downsample=downsample)
        else:
            L = read_layer(f, polarization, frequency, epsg_override, bbox_lonlat=bbox, downsample=downsample)
        when = info["startUtc"] or _iso_from_file(L.start_time)
        if not when: raise GcovFormatError(f"{_base(f)}: no acquisition time in file name or HDF5; cannot place on a timeline")
        src = "file name" if info["startUtc"] else "HDF5 zeroDopplerStartTime"
        d, tf = ch.crop_to_bbox(L.data, L.transform, L.epsg, bbox)
        if ref is None:
            ref = {"shape": d.shape, "tf": tf, "epsg": L.epsg, "pol": L.polarization, "freq": L.frequency, "units": L.units_attr}
        else:
            if (L.polarization, L.frequency) != (ref["pol"], ref["freq"]):
                raise ch.AlignmentError(f"{_base(f)}: polarization/frequency differ from first scene; refusing to compare")
            d, resampled = ch.align_to(d, tf, L.epsg, ref["shape"], ref["tf"], ref["epsg"])
            if resampled: notes.append(f"{_base(f)} resampled onto the first scene's grid")
        notes += [f"{_base(f)}: {x}" for x in L.notes]
        scenes.append({"id": re.sub(r"_(VV|VH|HH|HV)$", "", _base(f).rsplit(".", 1)[0]), "when": when, "timeSource": src, "power": ch.nan_boxcar(d, speckle_window), "info": info})
    scenes.sort(key=lambda s: s["when"])

    excl = None
    mask_names: list[str] = []
    for mp in exclude_masks:
        m = ch.load_exclude_mask(mp, ref["shape"], ref["tf"], ref["epsg"])
        excl = m if excl is None else (excl | m); mask_names.append(Path(mp).name)

    if event_date:
        ev = datetime.fromisoformat(event_date).replace(tzinfo=timezone.utc)
        base_idx = [i for i, s in enumerate(scenes) if datetime.fromisoformat(s["when"]) < ev]
        if len(base_idx) < 2: raise ValueError(f"Only {len(base_idx)} scene(s) before event date {event_date}; need >= 2 for a baseline")
    else:
        base_idx = list(range(min(baseline_n, len(scenes) - 1)))
        notes.append(f"no event date given: first {len(base_idx)} scenes used as baseline")
    base_set = set(base_idx)

    dbs = [ch.to_db(s["power"], params.min_valid_power) for s in scenes]
    stack_base = np.stack([dbs[i] for i in base_idx])
    with np.errstate(all="ignore"):
        base_db = np.nanmedian(stack_base, axis=0)
    valid_base = np.isfinite(base_db)
    if excl is not None: valid_base &= ~excl.astype(bool)
    if not valid_base.any(): raise ValueError("No valid baseline pixels in the AOI")

    out_dir = out_root / site["siteId"]; ts_dir = out_dir / "ts"; ts_dir.mkdir(parents=True, exist_ok=True)
    px_km2 = ch.pixel_area_km2(ref["tf"], ref["epsg"], ref["shape"])
    points = []
    bounds = None
    # one common grey stretch for every date, so before/after images are directly comparable in the Compare tab
    allv = np.concatenate([d[valid_base & np.isfinite(d)][::7] for d in dbs]) if write_overlays else np.array([])
    lo, hi = (float(np.percentile(allv, 2)), float(np.percentile(allv, 98))) if allv.size else (-25.0, 0.0)
    if hi <= lo: hi = lo + 1.0
    for i, s in enumerate(scenes):
        mean_db, med_db, nvalid = _mean_db(np.where(valid_base, s["power"], np.nan), params.min_valid_power)
        valid = valid_base & np.isfinite(dbs[i])
        cand = valid & ((dbs[i] - base_db) <= threshold_db)
        if min_pixels > 1 and cand.any():
            from scipy import ndimage as ndi
            lab, n = ndi.label(cand); sizes = ndi.sum(cand, lab, index=np.arange(1, n + 1))
            keep = np.zeros(n + 1, dtype=bool); keep[1:] = sizes >= min_pixels; cand = keep[lab]
        area = float(cand.sum()) * px_km2  # constant pixel area at AOI centre; polygon-exact area is used for single pairs in run_site
        pt = {"time": s["when"], "productId": s["id"], "cycle": s["info"]["cycle"], "isBaseline": i in base_set,
              "meanDb": None if mean_db is None else round(mean_db, 4), "medianDb": None if med_db is None else round(med_db, 4),
              "validCoverage": round(float(valid.mean()), 5), "changedPixels": int(cand.sum()),
              "changedAreaKm2": round(area, 5), "changedPercent": round(100.0 * float(cand.sum()) / max(int(valid.sum()), 1), 4),
              "timeSource": s["timeSource"], "overlay": None, "image": None}
        if write_overlays:
            c4326, b = ex._to_4326(cand.astype("float32"), ref["tf"], ref["epsg"], categorical=True)
            bounds = bounds or b
            name = f"ts/{datetime.fromisoformat(s['when']).strftime('%Y%m%dT%H%M%S')}.png"
            ex._change_png(out_dir / name, c4326); pt["overlay"] = name
            d4326, _ = ex._to_4326(np.where(valid_base, dbs[i], np.nan), ref["tf"], ref["epsg"])
            iname = name.replace(".png", "_db.png")
            ex._true_gray_png(out_dir / iname, d4326, lo, hi); pt["image"] = iname
        points.append(pt)

    base_means = np.array([points[i]["meanDb"] for i in base_idx if points[i]["meanDb"] is not None], dtype="float64")
    b_mean = float(base_means.mean()) if base_means.size else None
    b_std = float(base_means.std(ddof=1)) if base_means.size >= 2 else None
    for p in points:
        p["deltaDb"] = None if p["meanDb"] is None or b_mean is None else round(p["meanDb"] - b_mean, 4)
        p["z"] = (round((p["meanDb"] - b_mean) / b_std, 3) if (p["meanDb"] is not None and b_std and base_means.size >= 3) else None)

    t0 = datetime.fromisoformat(points[0]["time"])
    t_days = np.array([(datetime.fromisoformat(p["time"]) - t0).total_seconds() / 86400 for p in points])
    y = np.array([np.nan if p["meanDb"] is None else p["meanDb"] for p in points])
    ok = np.isfinite(y)
    mk = mann_kendall(y[ok]); slope = sen_slope(t_days[ok], y[ok])
    gaps = np.diff(t_days)
    peak_area = max(points, key=lambda p: p["changedAreaKm2"])
    drops = [p for p in points if p["deltaDb"] is not None]
    peak_drop = min(drops, key=lambda p: p["deltaDb"]) if drops else None
    ts = {
        "schemaVersion": 1, "siteId": site["siteId"], "name": site.get("name", site["siteId"]), "eventName": site["eventName"],
        "country": site.get("country"), "mission": mission, "productType": "RTC-S1 (OPERA)" if s1 else "GCOV",
        "band": "C" if s1 else "L", "polarization": ref["pol"], "frequency": ref["freq"],
        "bounds": bounds, "processingCrs": f"EPSG:{ref['epsg']}", "aoi": {"type": "bbox", "bboxLonLat": list(bbox)},
        "track": infos[0]["track"], "direction": infos[0]["direction"], "frame": infos[0]["frame"],
        "eventDate": event_date, "synthetic": bool(synthetic),
        "visualisationStretchDb": [round(lo, 3), round(hi, 3)],
        "method": {"name": "per-pixel median-dB baseline; decrease candidates", "thresholdDb": threshold_db, "speckleWindow": speckle_window,
                   "minMappingPixels": min_pixels, "baselineScenes": len(base_idx), "aoiMean": "mean of linear power, then 10*log10",
                   "areaMethod": "changed pixels x pixel area at AOI centre in equal-area EPSG:6933", "masks": mask_names},
        "baseline": {"meanDb": None if b_mean is None else round(b_mean, 4), "stdDb": None if b_std is None else round(b_std, 4), "n": int(base_means.size)},
        "points": points,
        "trend": {"mannKendall": mk, "senSlopeDbPerDay": None if slope is None else round(slope, 5), "scenes": int(ok.sum()),
                  "note": "Needs >= 4 scenes; meaningless across an abrupt event unless interpreted with the event date."},
        "summary": {"scenes": len(points), "firstTime": points[0]["time"], "lastTime": points[-1]["time"],
                    "medianGapDays": round(float(np.median(gaps)), 2), "maxGapDays": round(float(gaps.max()), 2),
                    "peakChangedAreaKm2": peak_area["changedAreaKm2"], "peakChangedAreaTime": peak_area["time"],
                    "largestDropDb": None if peak_drop is None else peak_drop["deltaDb"], "largestDropTime": None if peak_drop is None else peak_drop["time"]},
        "quality": {"operatorNotes": notes, "processedAt": datetime.now(timezone.utc).isoformat(),
                    "unitsAttribute": ref["units"]},
        "validation": None,
        "limitations": LIMITATIONS + (S1_LIMITATIONS if s1 else []),
    }
    (out_dir / "timeseries.json").write_text(json.dumps(ts, indent=2), encoding="utf-8")
    from ..rebuild_index import rebuild
    rebuild(out_root)  # scan the folders instead of editing the old index: every processed site is always listed
    return ts
