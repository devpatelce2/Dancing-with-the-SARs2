"""UNIT TESTS ON A SYNTHETIC FIXTURE (random noise + a planted dark square).
The fixture follows the HDF5 layout the reader EXPECTS; it is NOT a NISAR file and these tests are NOT evidence of
real-data performance or of the real GCOV layout."""
import json, subprocess
from pathlib import Path
import h5py, numpy as np, pytest
from pyproj import Transformer
from shapely.geometry import shape
from pipeline.nisar import gcov_reader as gr
from pipeline.processing import change as ch
from pipeline import run_site

EPSG, X0, Y0, PX, N = 32643, 270000.0, 2370000.0, 30.0, 100


def make_fixture(path, *, dark=True, shift=0.0, pol="HHHH", extra_pol=None, time="2025-01-01T00:00:00", nodata_block=False,
                 drop_coords=False, seed=1):
    rng = np.random.default_rng(seed)
    a = (0.1 * rng.gamma(40, 1 / 40, (N, N))).astype("float32")     # mild multilooked-like noise, mean 0.1
    if dark: a[40:60, 40:60] *= 0.05                                 # planted -13 dB square (400 px)
    if nodata_block: a[:10, :10] = np.nan
    with h5py.File(path, "w") as f:
        g = f.create_group("science/LSAR/GCOV/grids/frequencyA")
        for p in [pol] + ([extra_pol] if extra_pol else []): g.create_dataset(p, data=a)
        if not drop_coords:
            g.create_dataset("xCoordinates", data=X0 + shift + PX * (np.arange(N) + 0.5))
            g.create_dataset("yCoordinates", data=Y0 - PX * (np.arange(N) + 0.5))
        pr = g.create_dataset("projection", data=np.int32(EPSG)); pr.attrs["epsg_code"] = EPSG
        f.create_dataset("science/LSAR/identification/zeroDopplerStartTime", data=np.bytes_(time))


def bbox():
    t = Transformer.from_crs(EPSG, 4326, always_xy=True)
    w, s = t.transform(X0 + 300, Y0 - 2700); e, n = t.transform(X0 + 2700, Y0 - 300)
    return (w, s, e, n)


def test_reader_reads_layout_and_orients(tmp_path):
    p = tmp_path / "a.h5"; make_fixture(p)
    L = gr.read_layer(str(p))
    assert L.epsg == EPSG and L.polarization == "HHHH" and L.frequency == "frequencyA" and L.start_time.startswith("2025-01-01")
    assert L.data.shape == (N, N) and L.transform.a == PX and L.transform.e == -PX and L.transform.c == X0 and L.transform.f == Y0


def test_reader_fails_loudly(tmp_path):
    p = tmp_path / "amb.h5"; make_fixture(p, extra_pol="VVVV")
    with pytest.raises(gr.GcovFormatError, match="Multiple layers"): gr.read_layer(str(p))
    assert gr.read_layer(str(p), "VVVV").polarization == "VVVV"
    q = tmp_path / "nocoords.h5"; make_fixture(q, drop_coords=True)
    with pytest.raises(gr.GcovFormatError, match="Missing"): gr.read_layer(str(q))
    with h5py.File(tmp_path / "empty.h5", "w") as f: f.create_dataset("x", data=1)
    with pytest.raises(gr.GcovFormatError, match="No matching"): gr.read_layer(str(tmp_path / "empty.h5"))


def test_epsg_and_time_overrides_are_recorded(tmp_path):
    p = tmp_path / "a.h5"; make_fixture(p)
    L = gr.read_layer(str(p), epsg_override=EPSG, time_override="2025-03-03T00:00:00Z")
    assert any("supplied by operator" in n for n in L.notes) and L.start_time == "2025-03-03T00:00:00Z"


def test_params_validation():
    with pytest.raises(ValueError): ch.ChangeParams(threshold_db=1.0)
    with pytest.raises(ValueError): ch.ChangeParams(threshold_db=-3, speckle_window=2)


def test_change_detection_finds_planted_square_only(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b, dark=False, seed=1); make_fixture(a, dark=True, seed=2)
    L1, L2 = gr.read_layer(str(b)), gr.read_layer(str(a))
    res = ch.detect(L1.data, L2.data, ch.ChangeParams(-6.0, speckle_window=3, min_mapping_pixels=9))
    c = res["candidate"]
    assert c[45:55, 45:55].all()                       # interior of planted square detected
    assert c.sum() < 520                               # no large false-alarm area
    assert not c[:30, :].any() and not c[70:, :].any()
    poly, km2 = ch.polygonize(c, L1.transform, EPSG)
    # 3x3 speckle averaging erodes the square's 1-px border: expect the 18x18 interior (324 px) -> 324*900 m2 = 0.2916 km2
    assert c.sum() == 324 and km2 == pytest.approx(324 * PX * PX / 1e6, rel=0.01)
    raw = ch.detect(L1.data, L2.data, ch.ChangeParams(-6.0, speckle_window=1, min_mapping_pixels=9))["candidate"]
    assert 380 <= raw.sum() <= 420                      # without speckle averaging the full 400-px square is recovered
    assert abs(km2 - sum(f["properties"]["areaKm2"] for f in poly["features"])) < 1e-6
    for f in poly["features"]:
        g = shape(f["geometry"]); assert g.is_valid and not g.is_empty
        assert -180 <= g.bounds[0] <= 180 and -90 <= g.bounds[1] <= 90      # reprojected to degrees


def test_nodata_is_masked_not_counted(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b, dark=False, nodata_block=True); make_fixture(a, dark=False)
    L1, L2 = gr.read_layer(str(b)), gr.read_layer(str(a))
    res = ch.detect(L1.data, L2.data, ch.ChangeParams(-3.0, speckle_window=1, min_mapping_pixels=1))
    assert not res["valid"][:10, :10].any() and not res["candidate"][:10, :10].any()
    assert res["valid"].sum() == N * N - 100
    z = np.full((4, 4), 0.0, dtype="float32"); o = np.full((4, 4), 0.1, dtype="float32")
    assert not ch.detect(z, o, ch.ChangeParams(-3.0, 1, 1))["valid"].any()      # zero power is invalid, not -inf


def test_alignment_passthrough_and_resample(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b); make_fixture(a, shift=15.0)  # half-pixel shift
    L1, L2 = gr.read_layer(str(b)), gr.read_layer(str(a))
    same, r0 = ch.align_to(L1.data, L1.transform, EPSG, L1.data.shape, L1.transform, EPSG)
    assert r0 is False and same is L1.data
    moved, r1 = ch.align_to(L2.data, L2.transform, EPSG, L1.data.shape, L1.transform, EPSG)
    assert r1 is True and moved.shape == L1.data.shape
    with pytest.raises(ch.AlignmentError): ch.detect(np.ones((3, 3), "float32"), np.ones((4, 4), "float32"), ch.ChangeParams(-3))


def test_end_to_end_outputs_and_contract(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b, dark=False, seed=1, time="2025-01-01T00:00:00"); make_fixture(a, dark=True, seed=2, time="2025-01-13T00:00:00")
    out = tmp_path / "data"
    meta = run_site.process(before_path=str(b), after_path=str(a), bbox=bbox(), polarization="HHHH", params=ch.ChangeParams(-6.0),
                            out_root=out, site={"siteId": "fixture-site", "eventName": "SYNTHETIC UNIT-TEST FIXTURE"})
    d = out / "fixture-site"
    for f in ("before.png", "after.png", "change.png", "change.geojson", "before.tif", "after.tif", "change.tif", "meta.json"):
        assert (d / f).is_file(), f
    import rasterio
    with rasterio.open(d / "change.tif") as r: assert r.crs.to_epsg() == EPSG and r.transform.a == PX
    gj = json.loads((d / "change.geojson").read_text()); assert gj["type"] == "FeatureCollection" and gj["features"]
    assert meta["stats"]["affectedAreaKm2"] == pytest.approx(sum(f["properties"]["areaKm2"] for f in gj["features"]), abs=1e-5)
    assert meta["validation"] is None and meta["limitations"] and meta["method"]["thresholdDb"] == -6.0
    assert json.loads((out / "sites.json").read_text())["sites"][0]["id"] == "fixture-site"
    # cross-check with the FRONTEND validator so Python output and JS contract cannot drift
    js = ("import {validateMeta} from './src/lib/siteData.js';import fs from 'fs';"
          f"const r=validateMeta(JSON.parse(fs.readFileSync({json.dumps(str(d / 'meta.json'))},'utf8')));"
          "if(!r.ok){console.error(r.errors);process.exit(1)}")
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr


def test_run_site_refuses_mismatched_polarization(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b, pol="HHHH"); make_fixture(a, pol="VVVV")
    with pytest.raises(gr.GcovFormatError): run_site.process(before_path=str(b), after_path=str(a), bbox=bbox(), polarization="HHHH", params=ch.ChangeParams(-3), out_root=tmp_path / "o", site={"siteId": "x", "eventName": "t"})
