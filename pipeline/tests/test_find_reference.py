import io, json
from datetime import datetime, timezone
from pipeline import find_reference as fr

PAYLOAD = {"feed": {"entry": [
    {"time_start": "2026-07-15T00:12:00Z", "title": "OPERA_L3_DSWx-S1_T46RBV_20260715", "links": [
        {"rel": fr.DATA_REL, "href": "https://x/OPERA_L3_DSWx-S1_T46RBV_20260715_B01_WTR.tif"},
        {"rel": fr.DATA_REL, "href": "https://x/OPERA_L3_DSWx-S1_T46RBV_20260715_B02_BWTR.tif"},
        {"rel": "other", "href": "https://x/readme.txt"}]},
    {"time_start": "2026-07-16T00:00:00Z", "title": "no water layer", "links": [{"rel": fr.DATA_REL, "href": "https://x/a_B05_CONF.tif"}]},
]}}

def test_parse_entries_keeps_only_the_water_classification_file():
    out = fr.parse_entries(PAYLOAD)
    assert len(out) == 1 and out[0]["url"].endswith("_B01_WTR.tif") and out[0]["time"].startswith("2026-07-15")

def test_cmr_url_has_box_and_window():
    u = fr.cmr_url("OPERA_L3_DSWX-S1_V1", [91.3, 24.9, 91.5, 25.1], datetime(2026, 7, 8, tzinfo=timezone.utc), datetime(2026, 7, 20, tzinfo=timezone.utc))
    assert "short_name=OPERA_L3_DSWX-S1_V1" in u and "bounding_box=91.3%2C24.9%2C91.5%2C25.1" in u and "2026-07-08T00%3A00%3A00Z" in u

def test_main_reports_network_failure_without_inventing_a_map(tmp_path, capsys):
    (tmp_path / "timeseries.json").write_text(json.dumps({"bounds": [91.3, 24.9, 91.5, 25.1]}))
    def boom(*a, **k): raise OSError("no network")
    assert fr.main(["--site-dir", str(tmp_path), "--sar-date", "2026-07-14"], opener=boom) == 3
    assert "could not reach NASA CMR" in capsys.readouterr().err

def test_main_lists_results(tmp_path, capsys):
    (tmp_path / "timeseries.json").write_text(json.dumps({"bounds": [91.3, 24.9, 91.5, 25.1]}))
    class R(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): pass
    assert fr.main(["--site-dir", str(tmp_path), "--sar-date", "2026-07-14"], opener=lambda *a, **k: R(json.dumps(PAYLOAD).encode())) == 0
    assert "_B01_WTR.tif" in capsys.readouterr().out
