"""Validation maths on a SYNTHETIC site and SYNTHETIC references. Proves the tool; says nothing about any real flood."""
import json
import numpy as np, pytest, rasterio
from PIL import Image
from rasterio.transform import from_bounds
from pipeline.validate import main
from pipeline.validation.metrics import validate_timeseries

B = [91.0, 24.0, 91.2, 24.2]; H = W = 100


def site(tmp_path, cand):
    d = tmp_path / "s1"; (d / "ts").mkdir(parents=True)
    rgba = np.zeros((H, W, 4), "uint8"); rgba[cand] = (255, 90, 60, 200); Image.fromarray(rgba, "RGBA").save(d / "ts/a.png")
    img = np.full((H, W, 4), 255, "uint8"); img[:, :5, 3] = 0; Image.fromarray(img, "RGBA").save(d / "ts/a_db.png")      # 5 columns without SAR data
    pt = {"time": "2026-07-14T12:00:00+00:00", "overlay": "ts/a.png", "image": "ts/a_db.png"}
    (d / "timeseries.json").write_text(json.dumps({"bounds": B, "points": [pt, {"time": "2026-09-24T12:00:00+00:00"}], "validation": None}))
    return d


def ref_tif(path, arr, epsg=4326):
    with rasterio.open(path, "w", driver="GTiff", height=H, width=W, count=1, dtype="uint8", crs=f"EPSG:{epsg}", transform=from_bounds(*B, W, H)) as dst:
        dst.write(arr.astype("uint8"), 1)
    return str(path)


def test_known_overlap_gives_known_scores(tmp_path):
    cand = np.zeros((H, W), bool); cand[20:60, 20:60] = True                       # 1600 px
    ref = np.zeros((H, W), "uint8"); ref[40:80, 20:60] = 1                          # 1600 px, 800 shared
    ref[0:5, 90:] = 253                                                             # cloud: ignored
    d = site(tmp_path, cand)
    b = validate_timeseries(d, "2026-07-14", ref_tif(tmp_path / "r.tif", ref), reference_name="unit ref", reference_source="synthetic", reference_date="2026-07-15")
    m = b["metrics"]
    assert (m["tp"], m["fp"], m["fn"]) == (800, 800, 800) and m["precision"] == 0.5 and m["recall"] == 0.5 and m["iou"] == pytest.approx(1 / 3)
    assert m["pixelsCompared"] == H * W - 5 * H - 50 and b["daysApart"] == 1 and b["referenceValues"]["253"] == 50
    saved = json.loads((d / "timeseries.json").read_text())["validation"]
    assert saved["reference"] == "unit ref - synthetic" and any("permanent" in c for c in saved["caveats"])


def test_reference_baseline_removes_permanent_water(tmp_path):
    cand = np.zeros((H, W), bool); cand[20:60, 20:60] = True
    now = np.zeros((H, W), "uint8"); now[20:60, 20:60] = 1; now[:, 80:85] = 1       # flood + a permanent river
    base = np.zeros((H, W), "uint8"); base[:, 80:85] = 1
    d = site(tmp_path, cand)
    without = validate_timeseries(d, "2026-07-14", ref_tif(tmp_path / "n.tif", now), reference_name="r", reference_source="s", reference_date="2026-07-14")
    assert without["metrics"]["recall"] < 0.8
    withb = validate_timeseries(d, "2026-07-14", ref_tif(tmp_path / "n.tif", now), reference_baseline_path=ref_tif(tmp_path / "b.tif", base),
                                reference_name="r", reference_source="s", reference_date="2026-07-14")
    assert withb["metrics"]["recall"] == 1.0 and withb["metrics"]["precision"] == 1.0 and "minus reference baseline" in withb["compared"]


def test_geojson_reference_and_cli(tmp_path, capsys):
    cand = np.zeros((H, W), bool); cand[25:75, 25:75] = True
    d = site(tmp_path, cand)
    gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon",
          "coordinates": [[[91.05, 24.05], [91.15, 24.05], [91.15, 24.15], [91.05, 24.15], [91.05, 24.05]]]}}]}
    (tmp_path / "f.geojson").write_text(json.dumps(gj))
    rc = main(["--site-dir", str(d), "--sar-date", "2026-07-14", "--reference", str(tmp_path / "f.geojson"), "--name", "polys", "--source", "synthetic", "--date", "2026-07-16"])
    out = capsys.readouterr().out
    assert rc == 0 and "precision 1.000" in out and "recall 1.000" in out


def test_clear_errors(tmp_path, capsys):
    d = site(tmp_path, np.zeros((H, W), bool)); r = ref_tif(tmp_path / "r.tif", np.zeros((H, W), "uint8"))
    assert main(["--site-dir", str(d), "--reference", r, "--name", "n", "--source", "s", "--date", "2026-07-14"]) == 2          # no --sar-date
    assert main(["--site-dir", str(d), "--sar-date", "2026-01-01", "--reference", r, "--name", "n", "--source", "s", "--date", "2026-07-14"]) == 2
    assert "available: 2026-07-14" in capsys.readouterr().err
    far = tmp_path / "far.tif"
    with rasterio.open(far, "w", driver="GTiff", height=10, width=10, count=1, dtype="uint8", crs="EPSG:4326", transform=from_bounds(10, 10, 11, 11, 10, 10), nodata=255) as dst:
        dst.write(np.ones((10, 10), "uint8"), 1)
    assert main(["--site-dir", str(d), "--sar-date", "2026-07-14", "--reference", str(far), "--name", "n", "--source", "s", "--date", "2026-07-14"]) == 2
    assert "does not overlap" in capsys.readouterr().err
