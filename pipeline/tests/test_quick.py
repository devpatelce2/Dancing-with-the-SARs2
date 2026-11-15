from pipeline.quick import spread

def link(day): return f"https://x/NISAR_L2_PR_GCOV_035_091_D_076_2005_DHDH_A_202610{day:02d}T000000_202610{day:02d}T000030_X05009_N_F_J_001.h5"

def test_spread_keeps_first_last_and_is_chronological():
    out = spread([link(d) for d in (28, 3, 9, 15, 21, 5, 12, 18)], 4)
    days = [int(u.split("_A_")[1][6:8]) for u in out]
    assert len(out) == 4 and days == sorted(days) and days[0] == 3 and days[-1] == 28

def test_spread_small_list_unchanged():
    assert len(spread([link(3), link(9)], 6)) == 2


def jl(m, d): return f"https://x/NISAR_L2_PR_GCOV_141_141_A_014_2005_DHDH_A_2026{m:02d}{d:02d}T000000_2026{m:02d}{d:02d}T000030_X05009_N_F_J_001.h5"

def test_pick_around_keeps_baseline_and_event_scenes():
    from pipeline.quick import pick_around
    urls = [jl(3, 1), jl(4, 6), jl(5, 12), jl(6, 17), jl(6, 29), jl(7, 5), jl(7, 17), jl(7, 29), jl(8, 10), jl(9, 3)]
    out = pick_around(urls, 6, "2026-07-11")
    days = [u.split("_DHDH_A_")[1][:8] for u in out]
    assert len(out) == 6 and days == sorted(days)
    assert sum(d < "20260711" for d in days) >= 2 and "20260717" in days and "20260729" in days

def test_pick_around_with_exact_minimum():
    from pipeline.quick import pick_around
    out = pick_around([jl(6, 23), jl(7, 5), jl(7, 17)], 6, "2026-07-11")
    assert len(out) == 3


def test_spread_ignores_comment_header_line():
    from pipeline.quick import spread
    assert spread(["# track 91 DESCENDING frame 76 - 3 GCOV scenes", link(3), link(9)], 0) == [link(3), link(9)]


def test_auto_mission_falls_back_to_sentinel1_when_nisar_has_no_scenes(monkeypatch, capsys):
    import argparse
    from pipeline import quick
    from pipeline.nisar import catalog
    a = argparse.Namespace(mission="auto", start="2023-12-14", end="2024-02-15")
    monkeypatch.setattr(catalog, "search", lambda *x, **k: {"usable": 0, "returned": 0, "records": []})
    assert quick.resolve_mission(a, (137.0, 37.0, 137.2, 37.2)) == "sentinel1"
    assert "launched in July 2025" in capsys.readouterr().out
    monkeypatch.setattr(catalog, "search", lambda *x, **k: {"usable": 4, "returned": 4, "records": []})
    assert quick.resolve_mission(a, (137.0, 37.0, 137.2, 37.2)) == "nisar"
    assert quick.resolve_mission(argparse.Namespace(mission="sentinel1", start="x", end=None), (0, 0, 1, 1)) == "sentinel1"


def test_rebuild_index_scans_folders_and_heals_a_stale_index(tmp_path):
    import json
    from pipeline import rebuild_index
    for sid, f, body in (("sylhet", "timeseries.json", '{"name": "Sylhet"}'), ("noto-peninsula", "timeseries.json", '{"name": "Noto Peninsula"}'),
                         ("pair", "meta.json", '{"name": "Pair"}'), ("geo", "x.json", "{}"), ("broken", "timeseries.json", "{nope")):
        (tmp_path / sid).mkdir(); (tmp_path / sid / f).write_text(body)
    (tmp_path / "sites.json").write_text('{"schemaVersion": 1, "sites": [{"id": "noto-peninsula", "name": "Noto Peninsula", "kind": "timeseries"}]}')
    assert rebuild_index.main(["--data", str(tmp_path)]) == 0
    sites = json.loads((tmp_path / "sites.json").read_text())["sites"]
    assert [s["id"] for s in sites] == ["noto-peninsula", "pair", "sylhet"] and "kind" not in sites[1] and sites[2]["kind"] == "timeseries"


def test_verify_live_runner_reports_pass_fail_skip_and_never_hides_errors(capsys):
    from pipeline import verify_live
    def boom(): raise RuntimeError("service said no")
    def skip(): raise LookupError("needs EARTHDATA_TOKEN")
    rows, failed = verify_live.run([("a", lambda: "fine"), ("b", boom), ("c", skip)])
    assert [r[0] for r in rows] == ["PASS", "FAIL", "SKIP"] and failed == 1 and "service said no" in rows[1][2]
    out = capsys.readouterr().out
    assert "PASS" in out and "FAIL" in out and "SKIP" in out


# ---- scene selection in quick.main (catalogue, search and processing are replaced by fakes; no network) ----
def _n(day, cyc, ver="P05023_N_F_J_001"):
    return f"https://nisar.asf.earthdatacloud.nasa.gov/x/NISAR_L2_PR_GCOV_{cyc:03d}_098_A_016_4005_DHDH_A_{day}T233918_{day}T233952_{ver}.h5"


def _fake_pipeline(monkeypatch, nisar, s1=()):
    from pipeline import quick
    from pipeline.nisar import catalog
    from pathlib import Path
    calls = {"find": [], "run": None}
    def fake_find(args):
        calls["find"].append(args[args.index("--mission") + 1])
        Path(args[args.index("--out") + 1]).write_text("# header\n" + "\n".join(nisar if args[args.index("--mission") + 1] == "nisar" else s1) + "\n")
        return 0
    def fake_run(args): calls["run"] = args; return 0
    monkeypatch.setattr(quick.find_scenes, "main", fake_find); monkeypatch.setattr(quick.run_timeseries, "main", fake_run)
    monkeypatch.setattr(catalog, "search", lambda *x, **k: {"usable": len(nisar), "returned": len(nisar), "records": []})
    return quick, calls


def _used(calls):
    from pathlib import Path
    a = calls["run"]; return [l for l in Path(a[a.index("--files-from") + 1]).read_text().splitlines() if l.strip()]


BASE = ["--site-id", "t", "--event", "e", "--bbox", "83.89", "28.27", "84.1", "28.48", "--start", "2026-09-01", "--threshold-db", "-3"]


def test_duplicate_products_of_one_pass_do_not_use_up_scene_slots(monkeypatch, capsys):
    scenes = [_n("20260924", 31), _n("20260924", 31, "P05023_F_F_J_001"), _n("20261018", 33), _n("20261030", 34), _n("20261111", 35), _n("20261111", 35, "P05036_F_F_J_001")]
    quick, calls = _fake_pipeline(monkeypatch, scenes)
    assert quick.main(BASE + ["--mission", "nisar", "--max-scenes", "3"]) == 0
    import re
    used = _used(calls); days = [re.search(r"_(\d{8})T\d{6}_\d{8}T", u).group(1) for u in used]
    assert len(used) == 3 and len(set(days)) == 3 and "Skipped 2 duplicate" in capsys.readouterr().out


def test_auto_switches_to_sentinel1_when_nisar_has_no_baseline_before_the_event(monkeypatch, capsys):
    nisar = [_n("20260620", 23), _n("20260702", 24), _n("20260714", 25), _n("20260726", 26)]            # only one pass before 23 June
    s1 = [f"https://x/OPERA_L2_RTC-S1_T100-213456-IW2_{d}T010203Z_20260801T000000Z_S1A_30_v1.0_VH.tif" for d in ("20260520", "20260601", "20260613", "20260625", "20260707")]
    quick, calls = _fake_pipeline(monkeypatch, nisar, s1)
    assert quick.main(BASE + ["--event-date", "2026-06-23", "--pol", "HVHV"]) == 0
    out = capsys.readouterr().out
    assert calls["find"] == ["nisar", "sentinel1"] and "Switching to Sentinel-1" in out and "using VH" in out
    a = calls["run"]; assert a[a.index("--mission") + 1] == "SENTINEL-1" and a[a.index("--pol") + 1] == "VH"


def test_clear_errors_when_baseline_or_dates_are_missing(monkeypatch, capsys):
    quick, calls = _fake_pipeline(monkeypatch, [_n("20260924", 31), _n("20261018", 33), _n("20261030", 34)])
    assert quick.main(BASE + ["--mission", "nisar", "--event-date", "2026-09-30"]) == 2                    # one scene before the event
    assert "at least 2 are needed for a baseline" in capsys.readouterr().err and calls["run"] is None
    quick, calls = _fake_pipeline(monkeypatch, [_n("20260924", 31), _n("20260924", 31, "P05023_F_F_J_001"), _n("20261018", 33)])
    assert quick.main(BASE + ["--mission", "nisar"]) == 2                                                  # 3 files but only 2 dates
    assert "only 2 distinct acquisition date" in capsys.readouterr().err and calls["run"] is None
