"""Sentinel-1 (OPERA RTC-S1) path: names, catalogue selection, burst mosaic + mask, full time series. Synthetic GeoTIFFs, no network."""
import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

from pipeline.nisar import catalog
from pipeline.nisar.gcov_reader import GcovFormatError
from pipeline.processing.timeseries import build_timeseries, detect_mission, parse_scene_name
from pipeline.sentinel1 import catalog as s1c
from pipeline.sentinel1.reader import read_rtc_scene

EPSG, X0, Y0, PX = 32653, 300000.0, 4200000.0, 30.0   # UTM 53N, around the Noto Peninsula
NX, NY = 400, 400                                      # 12 km square burst


def _name(burst, when):
    return f"OPERA_L2_RTC-S1_{burst}_{when:%Y%m%dT%H%M%S}Z_{when + timedelta(days=1):%Y%m%dT%H%M%S}Z_S1A_30_v1.0"


def _write(path, arr, y0, dtype="float32", nodata=np.nan):
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=dtype, crs=f"EPSG:{EPSG}",
                       transform=from_origin(X0, y0, PX, PX), nodata=nodata) as d:
        d.write(arr.astype(dtype), 1)


def make_pass(tmp, when, flood, rng, bursts=(("T064-135523-IW1", Y0), ("T064-135524-IW1", Y0 - 300 * PX)), mask=True):
    """Two vertically overlapping bursts of one scene of land with a river; `flood` darkens a patch."""
    paths = []
    for k, (b, y0) in enumerate(bursts):
        yy, xx = np.mgrid[0:NY, 0:NX]
        gy = (Y0 - y0) / PX + yy                       # shared row index so both bursts see the same ground
        p = np.full((NY, NX), 0.12) + 0.03 * np.sin(xx / 40.0) * np.cos(gy / 50.0)
        p[np.abs(xx - 200) < 6] = 0.008                 # permanent river
        if flood: p[(xx > 230) & (xx < 330) & (gy > 250) & (gy < 420)] = 0.012
        p = (p * rng.gamma(40, 1 / 40, size=p.shape)).astype("float32")
        stamp = when + timedelta(seconds=3 * k)
        base = tmp / _name(b, stamp)
        _write(f"{base}_VV.tif", p, y0)
        if mask:
            m = np.zeros((NY, NX), "uint8"); m[:5, :] = 255
            _write(f"{base}_mask.tif", m, y0, dtype="uint8", nodata=255)
        paths.append(f"{base}_VV.tif")
    return " ".join(paths)


def _bbox():
    t = Transformer.from_crs(EPSG, 4326, always_xy=True)
    w, s = t.transform(X0 + 1500, Y0 - 700 * PX + 1500)   # box spans both bursts
    e, n = t.transform(X0 + NX * PX - 1500, Y0 - 1500)
    return (w, s, e, n)


def test_parse_name_and_mission_detection():
    n = _name("T064-135523-IW1", datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc))
    info = parse_scene_name(n + "_VV.tif https://x/" + n + "_VV.tif")
    assert info["track"] == "064" and info["startUtc"].startswith("2024-01-01T09:30")
    assert detect_mission([n + "_VV.tif"]) == "SENTINEL-1"
    assert detect_mission(["NISAR_L2_PR_GCOV_001_091_D_076_4005_DHDH_A_20260711T000000_20260711T000010_X_N_F_J_001.h5"]) == "NISAR"


def test_layer_url_prefers_listed_url_then_derives():
    base = "https://datapool.asf.alaska.edu/RTC/OPERA-S1/OPERA_L2_RTC-S1_T064-135523-IW1_20240101T093000Z_20240102T120000Z_S1A_30_v1.0"
    assert s1c.layer_url({"downloadUrl": base + ".h5"}, "VV") == base + "_VV.tif"
    assert s1c.layer_url({"downloadUrl": base + ".h5", "raw": {"additionalUrls": [base + "_VH.tif", base + "_mask.tif"]}}, "mask") == base + "_mask.tif"
    assert s1c.layer_url({"downloadUrl": None}, "VV") is None


def _rec(burst, when, poly):
    n = _name(burst, when)
    return {"granuleId": n, "startTime": when.isoformat(), "flightDirection": "DESCENDING", "geometry": {"type": "Polygon", "coordinates": [poly]},
            "downloadUrl": f"https://datapool.asf.alaska.edu/RTC/OPERA-S1/{n}.h5", "raw": {}}


def test_select_groups_bursts_into_passes_and_prefers_covering_track():
    bbox = (137.0, 37.0, 137.2, 37.2)
    full_a = [[136.9, 36.9], [137.1, 36.9], [137.1, 37.3], [136.9, 37.3], [136.9, 36.9]]   # two bursts together cover the box
    full_b = [[137.1, 36.9], [137.3, 36.9], [137.3, 37.3], [137.1, 37.3], [137.1, 36.9]]
    sliver = [[137.15, 36.9], [137.4, 36.9], [137.4, 37.3], [137.15, 37.3], [137.15, 36.9]]  # other track: touches only a corner
    recs = []
    for i in range(5):
        t = datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc) + timedelta(days=12 * i)
        recs += [_rec("T064-135523-IW1", t, full_a), _rec("T064-135524-IW1", t + timedelta(seconds=3), full_b)]
        recs += [_rec("T120-000001-IW1", t + timedelta(hours=5), sliver) for _ in range(1)]
    lines, chosen, passes, why = s1c.select(recs, bbox, "VV")
    assert why is None and chosen == (64, "D") and len(passes) == 5
    assert all(len(p["urls"]) == 2 and p["cover"] > 0.95 for p in passes)
    assert all(u.endswith("_VV.tif") for p in passes for u in p["urls"])
    assert len(s1c.scene_lines(passes)) == 5 and " " in s1c.scene_lines(passes)[0]


def test_select_reports_empty_and_unmatched():
    assert s1c.select([], (0, 0, 1, 1))[1] is None
    _, chosen, _, why = s1c.select([_rec("T064-135523-IW1", datetime(2024, 1, 1, tzinfo=timezone.utc), [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]])], (0, 0, 1, 1))
    assert chosen is None and "covers the box" in why


def test_opera_search_params():
    p = catalog.build_params((137.0, 37.0, 137.2, 37.2), "2023-12-14", "2024-02-15", "RTC", 50, dataset="OPERA-S1")
    assert p["dataset"] == "OPERA-S1" and p["processingLevel"] == "RTC"
    with pytest.raises(ValueError): catalog.build_params((0, 0, 1, 1), None, None, "GCOV", 5, dataset="OPERA-S1")
    with pytest.raises(ValueError): catalog.build_params((0, 0, 1, 1), None, None, "RTC", 5, dataset="OTHER")


def test_reader_mosaics_bursts_and_applies_mask(tmp_path):
    rng = np.random.default_rng(1)
    when = datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc)
    scene = make_pass(tmp_path, when, 0, rng)
    L = read_rtc_scene(scene, "VV", bbox_lonlat=_bbox())
    assert L.epsg == EPSG and L.frequency == "C-band" and L.data.shape[0] > 600       # taller than one 400-px burst: two were mosaicked
    assert np.isfinite(L.data).mean() > 0.97
    assert any("mosaic of 2 burst" in n for n in L.notes)
    one = read_rtc_scene(scene.split()[0], "VV", bbox_lonlat=_bbox())
    assert np.isfinite(L.data).sum() > np.isfinite(one.data).sum()
    assert L.start_time.startswith("2024-01-01T09:30")
    d2 = read_rtc_scene(scene, "VV", bbox_lonlat=_bbox(), downsample=2)
    assert d2.data.shape[0] == L.data.shape[0] // 2 and abs(d2.transform.a) == 2 * PX


def test_reader_rejects_db_values_and_missing_overlap(tmp_path):
    rng = np.random.default_rng(2)
    f = tmp_path / (_name("T064-135523-IW1", datetime(2024, 1, 1, tzinfo=timezone.utc)) + "_VV.tif")
    _write(f, -10 + rng.normal(size=(NY, NX)), Y0)
    with pytest.raises(GcovFormatError, match="dB"): read_rtc_scene(str(f), "VV", bbox_lonlat=_bbox(), use_mask=False)
    with pytest.raises(GcovFormatError, match="does not overlap"):
        read_rtc_scene(str(f), "VV", bbox_lonlat=(10.0, 10.0, 10.1, 10.1), use_mask=False)


def test_mask_ignored_when_it_would_remove_everything(tmp_path):
    rng = np.random.default_rng(3)
    scene = make_pass(tmp_path, datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc), 0, rng, bursts=(("T064-135523-IW1", Y0),))
    mp = scene.replace("_VV.tif", "_mask.tif")
    _write(mp, np.full((NY, NX), 2, "uint8"), Y0, dtype="uint8", nodata=255)       # every pixel flagged layover
    t = Transformer.from_crs(EPSG, 4326, always_xy=True)
    bb = (*t.transform(X0 + 1500, Y0 - NY * PX + 1500), *t.transform(X0 + NX * PX - 1500, Y0 - 1500))
    L = read_rtc_scene(scene, "VV", bbox_lonlat=bb)
    assert any("mask ignored" in n for n in L.notes) and np.isfinite(L.data).mean() > 0.9


def test_full_sentinel1_time_series_detects_the_flood(tmp_path):
    rng = np.random.default_rng(4)
    t0 = datetime(2023, 12, 14, 9, 30, tzinfo=timezone.utc)
    flood = [0, 0, 0, 1, 1, 0]
    scenes = [make_pass(tmp_path, t0 + timedelta(days=12 * i), f, rng) for i, f in enumerate(flood)]
    out = tmp_path / "out"
    ts = build_timeseries(files=scenes, bbox=_bbox(), polarization="VV", threshold_db=-3.0, out_root=out,
                          site={"siteId": "noto-test", "name": "Noto", "eventName": "test"}, event_date="2024-01-08", min_pixels=9)
    assert ts["mission"] == "SENTINEL-1" and ts["band"] == "C" and ts["polarization"] == "VV" and ts["track"] == "064"
    assert any("C-band" in l for l in ts["limitations"])
    areas = [p["changedAreaKm2"] for p in ts["points"]]
    assert areas[3] > 5 * max(areas[:3]) and areas[4] > 5 * max(areas[:3]) and areas[5] < areas[3] / 3
    assert ts["points"][3]["deltaDb"] < ts["points"][0]["deltaDb"]
    saved = json.loads((out / "noto-test" / "timeseries.json").read_text(encoding="utf-8"))
    assert saved["mission"] == "SENTINEL-1" and (out / "noto-test" / ts["points"][3]["overlay"]).is_file()


def test_find_scenes_sentinel1_writes_one_pass_per_line(tmp_path, monkeypatch, capsys):
    from pipeline import find_scenes
    poly = [[136.9, 36.9], [137.3, 36.9], [137.3, 37.3], [136.9, 37.3], [136.9, 36.9]]
    recs = [_rec("T064-135523-IW1", datetime(2024, 1, 1, 9, 30, tzinfo=timezone.utc) + timedelta(days=12 * i), poly) for i in range(4)]
    monkeypatch.setattr(catalog, "search", lambda *a, **k: {"usable": 4, "returned": 4, "records": recs})
    out = tmp_path / "s.txt"
    rc = find_scenes.main(["--mission", "sentinel1", "--bbox", "137.0", "37.0", "137.2", "37.2", "--start", "2023-12-14", "--out", str(out)])
    lines = [l for l in out.read_text(encoding="utf-8").splitlines() if not l.startswith("#")]
    assert rc == 0 and len(lines) == 4 and all(l.startswith("https://") and l.endswith("_VV.tif") for l in lines)


def test_find_scenes_sentinel1_clear_error_when_empty(tmp_path, monkeypatch, capsys):
    from pipeline import find_scenes
    monkeypatch.setattr(catalog, "search", lambda *a, **k: {"usable": 0, "returned": 0, "records": []})
    rc = find_scenes.main(["--mission", "sentinel1", "--bbox", "137.0", "37.0", "137.2", "37.2", "--start", "2023-12-14", "--out", str(tmp_path / "s.txt")])
    assert rc == 2 and "no Sentinel-1 RTC-S1 scenes" in capsys.readouterr().err
