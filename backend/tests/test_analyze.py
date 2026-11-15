import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app import analyze as an


def test_build_command_validates_and_slugs():
    cmd, site = an.build_command(an.AnalyzeReq(place="Sylhet, Bangladesh", start="2026-10-01"))
    assert site == "sylhet" and "--place" in cmd and "pipeline.quick" in cmd
    with pytest.raises(ValueError): an.build_command(an.AnalyzeReq(place="x", start="01-10-2026"))
    with pytest.raises(ValueError): an.build_command(an.AnalyzeReq(place="x", start="2026-10-01", siteId="../bad"))


def test_geocode_endpoint(monkeypatch):
    monkeypatch.setattr(an, "geocode", lambda q: (24.9, 91.87, "Sylhet, Bangladesh"))
    r = TestClient(create_app()).get("/api/geocode", params={"q": "Sylhet", "half": 0.1})
    assert r.status_code == 200 and r.json()["bbox"] == [91.77, 24.8, 91.97, 25.0]


def test_analyze_requires_token(monkeypatch):
    for k in ("EARTHDATA_TOKEN", "EARTHDATA_USERNAME", "EARTHDATA_PASSWORD"): monkeypatch.delenv(k, raising=False)
    r = TestClient(create_app()).post("/api/analyze", json={"place": "Sylhet", "start": "2026-10-01"})
    assert r.status_code == 400 and "EARTHDATA_TOKEN" in r.json()["detail"]


def test_job_runner_reports_done_and_log():
    import sys
    an.JOBS["t"] = {"status": "running", "siteId": "s", "log": [], "progress": "", "returncode": None, "started": 0}
    an._run("t", [sys.executable, "-c", "print('hello'); print('x', flush=True)"])
    assert an.JOBS["t"]["status"] == "done" and "hello" in an.JOBS["t"]["log"]


def test_build_command_passes_end_and_event_date():
    cmd, _ = an.build_command(an.AnalyzeReq(place="Sunamganj, Bangladesh", start="2026-06-17", end="2026-07-31", eventDate="2026-07-11"))
    assert cmd[cmd.index("--end") + 1] == "2026-07-31" and cmd[cmd.index("--event-date") + 1] == "2026-07-11"
    with pytest.raises(ValueError): an.build_command(an.AnalyzeReq(place="x", start="2026-07-31", end="2026-06-17"))


def test_job_runner_survives_non_latin_output():
    import sys
    an.JOBS["u"] = {"status": "running", "siteId": "s", "log": [], "progress": "", "returncode": None, "started": 0}
    an._run("u", [sys.executable, "-m", "pipeline.__init__"] if False else [sys.executable, "-c", "import pipeline; print('Place: \u09b8\u09bf\u09b2\u09c7\u099f')"])
    assert an.JOBS["u"]["status"] == "done"


def test_error_line_prefers_real_error_over_last_line():
    log = ["ERROR: Only 1 scene(s) before event date 2026-07-11; need >= 2 for a baseline", "  (141, 'ASCENDING', 14): 3 scenes, 2026-06-23..2026-07-17"]
    assert an.error_line(log).startswith("ERROR: Only 1")
    assert an.error_line(["a", "ValueError: boom"]) == "ValueError: boom"


def test_build_command_passes_mission():
    cmd, _ = an.build_command(an.AnalyzeReq(place="Noto, Japan", start="2023-12-14"))
    assert cmd[cmd.index("--mission") + 1] == "auto"
    cmd, _ = an.build_command(an.AnalyzeReq(place="Noto, Japan", start="2023-12-14", mission="sentinel1"))
    assert cmd[cmd.index("--mission") + 1] == "sentinel1"
    with pytest.raises(Exception): an.AnalyzeReq(place="x", start="2023-12-14", mission="landsat")
