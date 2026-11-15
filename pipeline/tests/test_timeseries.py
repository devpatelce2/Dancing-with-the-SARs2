"""Synthetic-fixture tests: HDF5 files imitate the assumed NISAR GCOV layout (science/LSAR/GCOV/grids/frequencyA/HHHH ...).
They prove the code is self-consistent. They do NOT prove the real product layout; run hdf5_inspect on a real granule."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import h5py, numpy as np, pytest
from pyproj import Transformer
from pipeline.processing import timeseries as tsm
from pipeline.run_timeseries import main
from pipeline.nisar.gcov_reader import read_layer, GcovFormatError

EPSG = 32646
X0, Y0, STEP, NX, NY = 300000.0, 2780000.0, 200.0, 300, 400   # 60 km x 80 km grid, north-up when y descends
FLOOD = (slice(150, 250), slice(100, 200))                    # 100 x 100 px = 400 km2
PIX_KM2 = (STEP * STEP) / 1e6


def make_scene(dirpath: Path, cycle: int, when: datetime, drop_db: float, track="091", direction="D", frame="076", seed=0, pol_extra=True, mask_bad=None):
    rng = np.random.default_rng(seed + cycle)
    base = np.full((NY, NX), 0.08, dtype="float32")                      # ~ -11 dB
    base[:, :120] = 0.2                                                   # brighter land strip
    p = base.copy()
    if drop_db: p[FLOOD] *= 10 ** (drop_db / 10)
    p = p * rng.gamma(40, 1 / 40, size=p.shape).astype("float32")        # speckle, 40 looks
    stamp = when.strftime("%Y%m%dT%H%M%S")
    name = f"NISAR_L2_PR_GCOV_{cycle:03d}_{track}_{direction}_{frame}_4005_DHDH_A_{stamp}_{stamp}_P05036_N_F_J_001.h5"
    f = dirpath / name
    with h5py.File(f, "w") as h:
        g = h.create_group("science/LSAR/GCOV/grids/frequencyA")
        g.create_dataset("HHHH", data=p);
        if pol_extra: g.create_dataset("HVHV", data=p * 0.3)
        g.create_dataset("xCoordinates", data=X0 + STEP * (np.arange(NX) + 0.5))
        g.create_dataset("yCoordinates", data=Y0 - STEP * (np.arange(NY) + 0.5))
        if mask_bad is not None:
            m = np.ones((NY, NX), dtype="uint8"); m[mask_bad] = 0; m[:, -5:] = 255; g.create_dataset("mask", data=m)
        pr = g.create_dataset("projection", data=np.uint32(EPSG)); pr.attrs["epsg_code"] = EPSG
    return str(f)


def bbox_lonlat():
    t = Transformer.from_crs(EPSG, 4326, always_xy=True)
    w, s = t.transform(X0 + 5000, Y0 - NY * STEP + 5000); e, n = t.transform(X0 + NX * STEP - 5000, Y0 - 5000)
    return (w, s, e, n)


@pytest.fixture()
def stack(tmp_path):
    d = tmp_path / "in"; d.mkdir()
    t0 = datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc)
    drops = [0, 0, 0, 0, -8, -7, -3, 0, 0, 0]   # flood in scenes 5-7, partial recovery
    files = [make_scene(d, 24 + i, t0 + timedelta(days=12 * i), dr) for i, dr in enumerate(drops)]
    return files, t0, tmp_path / "out"


def run(files, out, **kw):
    args = dict(files=files, bbox=bbox_lonlat(), polarization="HHHH", threshold_db=-3.0, out_root=out,
                site={"siteId": "t1", "eventName": "synthetic flood"}, frequency="frequencyA", baseline_n=4, downsample=1)
    args.update(kw)
    return tsm.build_timeseries(**args)


def test_flood_peak_area_and_dates(stack):
    files, t0, out = stack
    ts = run(files, out, event_date=(t0 + timedelta(days=12 * 4 - 1)).strftime("%Y-%m-%d"))
    pts = ts["points"]
    assert [p["isBaseline"] for p in pts] == [True] * 4 + [False] * 6
    assert pts[4]["changedAreaKm2"] == pytest.approx(400.0, rel=0.03)         # 100x100 px x 0.04 km2
    assert pts[5]["changedAreaKm2"] == pytest.approx(400.0, rel=0.05)
    assert pts[0]["changedAreaKm2"] < 4 and pts[9]["changedAreaKm2"] < 4      # no event -> ~no candidates
    assert ts["summary"]["peakChangedAreaTime"][:10] in (pts[4]["time"][:10], pts[5]["time"][:10], pts[6]["time"][:10])
    # flood covers ~8% of the AOI, so the AOI-mean dilutes an 8 dB local drop to ~ -0.36 dB (why changed-area is a separate series)
    assert pts[4]["deltaDb"] == pytest.approx(-0.36, abs=0.1) and pts[9]["deltaDb"] == pytest.approx(0, abs=0.1)
    assert pts[4]["z"] is not None and pts[4]["z"] < -3                       # clear outlier vs 4 baseline scenes
    assert ts["baseline"]["n"] == 4 and ts["baseline"]["stdDb"] is not None


def test_outputs_written_and_contract(stack):
    files, t0, out = stack
    ts = run(files, out)
    d = out / "t1"
    assert (d / "timeseries.json").is_file() and len(list((d / "ts").glob("*.png"))) == 20
    j = json.loads((d / "timeseries.json").read_text())
    assert j["schemaVersion"] == 1 and j["bounds"] and len(j["points"]) == 10 and j["limitations"]
    assert json.loads((out / "sites.json").read_text())["sites"][0]["id"] == "t1"
    assert [p["time"] for p in j["points"]] == sorted(p["time"] for p in j["points"])


def test_mixed_track_rejected(stack, tmp_path):
    files, t0, out = stack
    d = tmp_path / "x"; d.mkdir()
    other = make_scene(d, 30, t0 + timedelta(days=200), 0, track="069", direction="A", frame="014")
    with pytest.raises(ValueError, match="different track"):
        run(files[:3] + [other], out)


def test_needs_three_scenes(stack):
    files, _, out = stack
    with pytest.raises(ValueError, match="at least 3"):
        run(files[:2], out)


def test_event_date_needs_two_baseline_scenes(stack):
    files, t0, out = stack
    with pytest.raises(ValueError, match="need >= 2"):
        run(files, out, event_date=(t0 + timedelta(hours=1)).strftime("%Y-%m-%d"))


def test_stats_helpers():
    y = np.array([1, 2, 3, 4, 5, 6.0]); mk = tsm.mann_kendall(y)
    assert mk["tau"] == pytest.approx(1.0) and mk["p"] < 0.05
    assert tsm.sen_slope(np.arange(6) * 12.0, y) == pytest.approx(1 / 12)
    assert tsm.mann_kendall(np.array([1, 2, 3.0])) is None
    flat = tsm.mann_kendall(np.array([1, 3, 2, 3, 1, 2.0])); assert flat["p"] > 0.3


def test_parse_scene_name():
    n = "NISAR_L2_PR_GCOV_034_091_D_076_4005_DHDH_A_20261030T123421_20261030T123455_P05036_N_F_J_001.h5"
    i = tsm.parse_scene_name(n)
    assert (i["cycle"], i["track"], i["direction"], i["frame"]) == ("034", "091", "D", "076")
    assert i["startUtc"].startswith("2026-10-30T12:34:21")


def test_cli_end_to_end(stack, capsys):
    files, t0, out = stack
    bb = bbox_lonlat()
    rc = main(["--site-id", "cli1", "--event", "synthetic", "--bbox", *map(str, bb), "--pol", "HHHH", "--frequency", "frequencyA",
               "--threshold-db", "-3", "--event-date", (t0 + timedelta(days=47)).strftime("%Y-%m-%d"), "--files", *files, "--out", str(out)])
    assert rc == 0 and "peak changed area" in capsys.readouterr().out
    assert main(["--site-id", "cli2", "--event", "x", "--bbox", *map(str, bb), "--pol", "HHHH", "--threshold-db", "3", "--files", *files, "--out", str(out)]) == 2


# ---- reader: window, block mean, mask, outside-scene (needed for real 34000 x 34000 px grids) ----
def test_window_read_equals_full_read(tmp_path):
    f = make_scene(tmp_path, 30, datetime(2026, 7, 1, tzinfo=timezone.utc), 0)
    full = read_layer(f, "HHHH", "frequencyA")
    bb = list(bbox_lonlat()); t = Transformer.from_crs(4326, EPSG, always_xy=True)
    cx, cy = t.transform((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
    from pyproj import Transformer as T2
    inv = T2.from_crs(EPSG, 4326, always_xy=True)
    w, s_ = inv.transform(cx - 6000, cy - 6000); e, n = inv.transform(cx + 6000, cy + 6000)
    win = read_layer(f, "HHHH", "frequencyA", bbox_lonlat=(w, s_, e, n))
    assert win.data.shape[0] < full.data.shape[0] and win.data.shape[1] < full.data.shape[1]
    c0 = round((win.transform.c - full.transform.c) / full.transform.a); r0 = round((win.transform.f - full.transform.f) / full.transform.e)
    sub = full.data[r0:r0 + win.data.shape[0], c0:c0 + win.data.shape[1]]
    np.testing.assert_array_equal(win.data, sub)
    assert any("AOI only" in n for n in win.notes)


def test_block_mean_preserves_mean_and_pixel_size(tmp_path):
    f = make_scene(tmp_path, 31, datetime(2026, 7, 1, tzinfo=timezone.utc), 0)
    full = read_layer(f, "HHHH", "frequencyA"); d = read_layer(f, "HHHH", "frequencyA", downsample=8)
    assert d.data.shape == (NY // 8, NX // 8) and d.transform.a == pytest.approx(STEP * 8) and d.transform.e == pytest.approx(-STEP * 8)
    assert np.nanmean(d.data) == pytest.approx(np.nanmean(full.data), rel=0.01)
    assert any("block mean" in n for n in d.notes)


def test_mask_zero_and_255_excluded_from_blocks(tmp_path):
    f = make_scene(tmp_path, 32, datetime(2026, 7, 1, tzinfo=timezone.utc), 0, mask_bad=(slice(0, 80), slice(0, 80)))
    r = read_layer(f, "HHHH", "frequencyA")
    assert np.isnan(r.data[:80, :80]).all() and np.isnan(r.data[:, -5:]).all() and np.isfinite(r.data[100:, 100:290]).all()
    d = read_layer(f, "HHHH", "frequencyA", downsample=8)
    assert np.isnan(d.data[:10, :10]).all() and np.isfinite(d.data[20:, 20:30]).all()      # fully-masked blocks -> NaN, others valid


def test_aoi_outside_scene_has_clear_error(tmp_path):
    f = make_scene(tmp_path, 33, datetime(2026, 7, 1, tzinfo=timezone.utc), 0)
    with pytest.raises(GcovFormatError, match="does not overlap this scene"):
        read_layer(f, "HHHH", "frequencyA", bbox_lonlat=(10.0, 10.0, 10.5, 10.5))


def test_both_frequencies_need_explicit_choice_and_cli_defaults_to_A(tmp_path, capsys):
    d = tmp_path / "in"; d.mkdir(); t0 = datetime(2026, 6, 20, 12, tzinfo=timezone.utc)
    files = [make_scene(d, 24 + i, t0 + timedelta(days=12 * i), -8 if i == 3 else 0) for i in range(5)]
    # add a frequencyB group like real files
    for f in files:
        with h5py.File(f, "a") as h:
            h.copy("science/LSAR/GCOV/grids/frequencyA", h["science/LSAR/GCOV/grids"], "frequencyB")
    with pytest.raises(GcovFormatError, match="Ambiguous"):
        read_layer(files[0], "HHHH")
    rc = main(["--site-id", "b1", "--event", "x", "--bbox", *map(str, bbox_lonlat()), "--pol", "HHHH", "--threshold-db", "-3",
               "--downsample", "2", "--event-date", "2026-08-01", "--files", *files, "--out", str(tmp_path / "o")])
    assert rc == 0
    assert json.loads((tmp_path / "o/b1/timeseries.json").read_text())["frequency"] == "frequencyA"


def test_block_mean_independent_of_strip_size(tmp_path, monkeypatch):
    import pipeline.nisar.gcov_reader as gr
    f = make_scene(tmp_path, 34, datetime(2026, 7, 1, tzinfo=timezone.utc), -6, mask_bad=(slice(0, 40), slice(0, 40)))
    a = gr.read_layer(f, "HHHH", "frequencyA", downsample=8).data
    monkeypatch.setattr(gr, "STRIP_ROWS", 16)           # forces many small strips
    b = gr.read_layer(f, "HHHH", "frequencyA", downsample=8).data
    np.testing.assert_array_equal(a, b)


def test_per_date_backscatter_images_and_common_stretch(stack):
    files, _, out = stack
    ts = run(files, out)
    assert ts["synthetic"] is False and ts["visualisationStretchDb"][0] < ts["visualisationStretchDb"][1]
    for p in ts["points"]:
        assert p["image"].endswith("_db.png") and (out / "t1" / p["image"]).is_file() and (out / "t1" / p["overlay"]).is_file()


def test_make_demo_is_flagged_synthetic_and_removable(tmp_path):
    from pipeline import make_demo
    assert make_demo.main(["--out", str(tmp_path)]) == 0
    j = json.loads((tmp_path / "synthetic-demo/timeseries.json").read_text())
    assert j["synthetic"] is True and "SYNTHETIC" in j["name"] and max(p["changedAreaKm2"] for p in j["points"]) > 50
    assert make_demo.main(["--out", str(tmp_path), "--remove"]) == 0
    assert not (tmp_path / "synthetic-demo").exists() and json.loads((tmp_path / "sites.json").read_text())["sites"] == []


def test_two_products_of_the_same_pass_are_counted_once(stack, tmp_path):
    import shutil
    files, t0, out = stack
    dup = files[1].replace("_P05036_N_F_J_001.h5", "_P05036_F_F_J_001.h5"); shutil.copy(files[1], dup)      # same pass, second product
    kept, dropped = tsm.dedupe_acquisitions(files + [dup])
    assert len(kept) == len(files) and len(dropped) == 1 and (dup in kept) != (dup in dropped)
    ts = run(files + [dup], out)
    times = [p["time"] for p in ts["points"]]
    assert len(times) == len(set(times)) == len(files) and any("same satellite pass" in n for n in ts["quality"]["operatorNotes"])
    with pytest.raises(ValueError, match="distinct acquisition dates"):
        run([files[0], files[1], dup], out)
