"""Fakes/synthetic only. Download behaviour is NOT verified against real Earthdata/ASF here."""
import json
from pathlib import Path
import numpy as np, pytest, rasterio
from rasterio.transform import from_origin
from pipeline.config import EarthdataAuth
from pipeline.nisar import download as dl
from pipeline.processing import change as ch
from pipeline.processing.export import write_geotiff
from pipeline.validation import metrics as vm
from pipeline.tests.test_processing import make_fixture, bbox, EPSG, X0, Y0, PX, N
from pipeline import run_site

AUTH = EarthdataAuth(token="tok-SECRET", username=None, password=None)
URL = "https://data.asf.alaska.edu/NISAR/GCOV/x.h5"

class FakeResp:
    def __init__(s, code=200, body=b"abc", ctype="application/x-hdf5"): s.status_code, s.body, s.headers = code, body, {"Content-Type": ctype}
    def __enter__(s): return s
    def __exit__(s, *a): return False
    def iter_content(s, n): yield s.body
class FakeSession:
    def __init__(s, *resps): s.resps = list(resps); s.calls = 0
    def get(s, *a, **k): s.calls += 1; return s.resps.pop(0)

def test_url_allowlist_blocks_credential_leak():
    for bad in ("http://data.asf.alaska.edu/x", "https://evil.example.com/x", "https://asf.alaska.edu.evil.com/x"):
        with pytest.raises(dl.DownloadError): dl.check_url(bad)
    assert dl.check_url(URL) == URL

def test_download_ok_resume_and_size_check(tmp_path):
    p = dl.download_granule(URL, tmp_path, "x.h5", expected_bytes=3, auth=AUTH, session=FakeSession(FakeResp()), sleep=lambda s: None)
    assert p.read_bytes() == b"abc" and not (tmp_path / "x.h5.part").exists()
    s2 = FakeSession(); assert dl.download_granule(URL, tmp_path, "x.h5", expected_bytes=3, auth=AUTH, session=s2) == p and s2.calls == 0  # already present
    with pytest.raises(dl.DownloadError, match="size mismatch"):
        dl.download_granule(URL, tmp_path, "y.h5", expected_bytes=99, auth=AUTH, session=FakeSession(*[FakeResp()] * 3), sleep=lambda s: None)

@pytest.mark.parametrize("resp,msg", [(FakeResp(401), "rejected"), (FakeResp(404), "not found"), (FakeResp(200, ctype="text/html"), "HTML login")])
def test_download_error_messages_are_clean(tmp_path, resp, msg):
    with pytest.raises(dl.DownloadError, match=msg) as e: dl.download_granule(URL, tmp_path, "z.h5", auth=AUTH, session=FakeSession(resp))
    assert "tok-SECRET" not in str(e.value)

def test_download_retries_then_succeeds_and_requires_credentials(tmp_path):
    s = FakeSession(FakeResp(503), FakeResp())
    assert dl.download_granule(URL, tmp_path, "r.h5", auth=AUTH, session=s, sleep=lambda x: None).is_file() and s.calls == 2
    with pytest.raises(dl.DownloadError, match="not configured"): dl.download_granule(URL, tmp_path, "q.h5", auth=EarthdataAuth(None, None, None))
    with pytest.raises(dl.DownloadError, match="unsafe"): dl.download_granule(URL, tmp_path, "../q.h5", auth=AUTH)

def _mask_tif(path, block):
    a = np.zeros((N, N), dtype="uint8")
    a[block] = 1
    write_geotiff(path, a, from_origin(X0, Y0, PX, PX), EPSG, nodata=None, dtype="uint8")

def test_exclude_mask_removes_candidates_and_is_recorded(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b, dark=False, seed=1); make_fixture(a, dark=True, seed=2)
    m = tmp_path / "perm_water.tif"; _mask_tif(m, (slice(40, 60), slice(40, 50)))   # excludes left half of the planted square
    out = tmp_path / "o"
    meta = run_site.process(before_path=str(b), after_path=str(a), bbox=bbox(), polarization="HHHH", params=ch.ChangeParams(-6.0, speckle_window=1),
                            out_root=out, site={"siteId": "m", "eventName": "SYNTHETIC"}, exclude_masks=[str(m)])
    base = run_site.process(before_path=str(b), after_path=str(a), bbox=bbox(), polarization="HHHH", params=ch.ChangeParams(-6.0, speckle_window=1),
                            out_root=tmp_path / "o2", site={"siteId": "m", "eventName": "SYNTHETIC"})
    assert meta["stats"]["changedPixels"] < base["stats"]["changedPixels"] * 0.6
    assert meta["processing"]["masks"] == ["perm_water.tif"] and any("excluded" in n for n in meta["quality"]["operatorNotes"])
    assert meta["stats"]["validCoverage"] < base["stats"]["validCoverage"]

def test_confusion_metrics_exact_and_edge_cases():
    c = np.array([[1, 1, 0, 0]], bool); r = np.array([[1, 0, 1, 0]], bool); v = np.ones_like(c)
    m = vm.confusion_metrics(c, r, v)
    assert (m["tp"], m["fp"], m["fn"], m["tn"]) == (1, 1, 1, 1) and m["precision"] == 0.5 and m["recall"] == 0.5 and m["f1"] == 0.5 and m["iou"] == pytest.approx(1 / 3)
    z = vm.confusion_metrics(np.zeros((1, 3), bool), np.zeros((1, 3), bool), np.ones((1, 3), bool))
    assert z["precision"] is None and z["f1"] is None            # no division by zero, no invented score
    assert vm.confusion_metrics(c, r, np.array([[1, 0, 0, 0]], bool))["pixelsCompared"] == 1

def test_validate_site_writes_documented_block(tmp_path):
    b, a = tmp_path / "b.h5", tmp_path / "a.h5"; make_fixture(b, dark=False, seed=1); make_fixture(a, dark=True, seed=2)
    out = tmp_path / "o"; run_site.process(before_path=str(b), after_path=str(a), bbox=bbox(), polarization="HHHH", params=ch.ChangeParams(-6.0, speckle_window=1),
                                           out_root=out, site={"siteId": "v", "eventName": "SYNTHETIC"})
    ref = tmp_path / "ref.tif"; _mask_tif(ref, (slice(40, 60), slice(40, 60)))     # SYNTHETIC "reference" equal to planted square
    blk = vm.validate_site(out / "v", str(ref), reference_name="synthetic test reference", reference_source="unit test", reference_date="2025-01-13")
    assert blk["metrics"]["recall"] > 0.9 and blk["metrics"]["precision"] > 0.9 and blk["caveats"]
    assert json.loads((out / "v" / "meta.json").read_text())["validation"]["reference"].startswith("synthetic test reference")
    with pytest.raises(ValueError, match="required"): vm.validate_site(out / "v", str(ref), reference_name="", reference_source="s", reference_date="d")
