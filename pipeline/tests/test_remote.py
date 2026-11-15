"""Streaming tests against a LOCAL HTTP Range server (auth header checked, bytes counted). They prove the mechanism, not NASA's servers."""
import functools, http.server, threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
import h5py, numpy as np, pytest, requests
from pyproj import Transformer
from pipeline.nisar import remote, gcov_reader, download as dl
from pipeline.nisar.gcov_reader import read_layer
from pipeline import find_scenes
from pipeline.run_timeseries import main

EPSG, X0, Y0, STEP, N = 32646, 300000.0, 2780000.0, 20.0, 2400   # 48 km x 48 km at 20 m, chunked + gzip like the real files
TOKEN = "unit-test-token"


def make_big(path: Path, seed=0):
    rng = np.random.default_rng(seed)
    p = (0.08 * rng.gamma(40, 1 / 40, size=(N, N))).astype("float32")
    with h5py.File(path, "w") as h:
        g = h.create_group("science/LSAR/GCOV/grids/frequencyA")
        g.create_dataset("HHHH", data=p, chunks=(256, 256), compression="gzip")
        g.create_dataset("xCoordinates", data=X0 + STEP * (np.arange(N) + 0.5)); g.create_dataset("yCoordinates", data=Y0 - STEP * (np.arange(N) + 0.5))
        pr = g.create_dataset("projection", data=np.uint32(EPSG)); pr.attrs["epsg_code"] = EPSG
    return p


class Handler(http.server.BaseHTTPRequestHandler):
    root: Path = Path(".")
    ignore_range = False
    sent = 0

    def log_message(self, *a): pass

    def do_GET(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.send_response(401); self.end_headers(); return
        f = self.root / self.path.lstrip("/")
        if not f.is_file(): self.send_response(404); self.end_headers(); return
        data = f.read_bytes(); rng = self.headers.get("Range")
        if rng and not Handler.ignore_range:
            a, b = rng.split("=")[1].split("-"); a = int(a); b = min(int(b), len(data) - 1); body = data[a:b + 1]
            self.send_response(206); self.send_header("Content-Range", f"bytes {a}-{b}/{len(data)}")
        else:
            body = data; self.send_response(200)
        self.send_header("Content-Length", str(len(body))); self.send_header("Content-Type", "application/x-hdf5"); self.end_headers()
        self.wfile.write(body); Handler.sent += len(body)


@pytest.fixture()
def server(tmp_path):
    Handler.root = tmp_path; Handler.ignore_range = False; Handler.sent = 0
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", tmp_path
    srv.shutdown()


def sess(token=TOKEN):
    s = requests.Session(); s.trust_env = False
    if token: s.headers["Authorization"] = f"Bearer {token}"
    return s


def bbox_small():
    inv = Transformer.from_crs(EPSG, 4326, always_xy=True)
    cx, cy = X0 + N * STEP / 2, Y0 - N * STEP / 2
    w, s = inv.transform(cx - 3000, cy - 3000); e, n = inv.transform(cx + 3000, cy + 3000)
    return (w, s, e, n)


@pytest.fixture()
def patched_open(monkeypatch):
    monkeypatch.setattr(gcov_reader, "open_h5", functools.partial(remote.open_h5, session=sess(), allow_http=True, allow_hosts=("127.0.0.1",)))


def test_streams_only_the_window(server):
    base, d = server; full = make_big(d / "a.h5")
    size = (d / "a.h5").stat().st_size
    with remote.open_h5(f"{base}/a.h5", session=sess(), allow_http=True, allow_hosts=("127.0.0.1",), block_size=256 * 1024) as (f, rf):
        got = f["science/LSAR/GCOV/grids/frequencyA/HHHH"][1000:1256, 1100:1356]
    np.testing.assert_array_equal(got, full[1000:1256, 1100:1356])
    assert rf.bytes_fetched < 0.25 * size and Handler.sent < 0.25 * size, (rf.bytes_fetched, size)
    assert "streamed" in rf.describe()


def test_read_layer_over_url_equals_local(server, patched_open):
    base, d = server; make_big(d / "b.h5")
    bb = bbox_small()
    remote_l = read_layer(f"{base}/b.h5", "HHHH", "frequencyA", bbox_lonlat=bb, downsample=4)
    local_l = read_layer(str(d / "b.h5"), "HHHH", "frequencyA", bbox_lonlat=bb, downsample=4)
    np.testing.assert_array_equal(remote_l.data, local_l.data)
    assert remote_l.transform == local_l.transform and any("streamed" in n for n in remote_l.notes)


def test_bad_token_is_a_clear_error_without_leaking_it(server):
    base, d = server; make_big(d / "c.h5")
    with pytest.raises(remote.RemoteError) as e:
        with remote.open_h5(f"{base}/c.h5", session=sess("wrong-token"), allow_http=True, allow_hosts=("127.0.0.1",)): pass
    assert "rejected the token" in str(e.value) and "wrong-token" not in str(e.value)


def test_server_ignoring_range_is_refused_not_downloaded(server):
    base, d = server; make_big(d / "e.h5"); Handler.ignore_range = True
    with pytest.raises(remote.RemoteError, match="ignored the Range"):
        with remote.open_h5(f"{base}/e.h5", session=sess(), allow_http=True, allow_hosts=("127.0.0.1",)): pass


def test_url_policy_and_missing_token(monkeypatch):
    for bad in ("http://nisar.asf.earthdatacloud.nasa.gov/x.h5", "https://evil.example.com/x.h5", "https://earthdatacloud.nasa.gov.evil.com/x.h5"):
        with pytest.raises(remote.RemoteError): remote.check_remote_url(bad)
    real = "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/NISAR_L2_GCOV_V1/N/N.h5"
    assert remote.check_remote_url(real) == real and dl.check_url(real) == real            # the real ASF host must be allowed
    for k in ("EARTHDATA_TOKEN", "EARTHDATA_USERNAME", "EARTHDATA_PASSWORD"): monkeypatch.delenv(k, raising=False)
    with pytest.raises(remote.RemoteError, match="token not set"):
        with remote.open_h5(real): pass


def rec(track, direction, frame, day, url=True):
    t = datetime(2026, 6, 20, tzinfo=timezone.utc) + timedelta(days=day)
    return {"pathNumber": track, "flightDirection": direction, "frameNumber": frame, "startTime": t.isoformat(),
            "downloadUrl": f"https://nisar.asf.earthdatacloud.nasa.gov/x/{track}_{frame}_{day}.h5" if url else None}


def test_select_groups_and_filters():
    recs = [rec(91, "DESCENDING", 76, d) for d in (0, 12, 24)] + [rec(69, "ASCENDING", 14, 5), rec(91, "DESCENDING", 76, 36, url=False)]
    g, k, why = find_scenes.select(recs)
    assert k is None and "choose one group" in why and len(g) == 2
    g, k, why = find_scenes.select(recs, pick_largest=True); assert k == (91, "DESCENDING", 76) and len(g[k]) == 3
    g, k, why = find_scenes.select(recs, track=69, direction="ascending"); assert k == (69, "ASCENDING", 14)
    g, k, why = find_scenes.select(recs, track=5); assert k is None and "0 groups" in why


def test_find_scenes_cli_writes_links_and_run_timeseries_reads_files_from(tmp_path, monkeypatch, capsys):
    recs = [rec(91, "DESCENDING", 76, d) for d in (0, 12, 24)]
    monkeypatch.setattr(find_scenes.catalog, "search", lambda *a, **k: {"usable": len(recs), "records": recs})
    out = tmp_path / "scenes.txt"
    assert find_scenes.main(["--bbox", "90.8", "24.3", "91.8", "25.2", "--start", "2026-06-17", "--pick-largest", "--out", str(out)]) == 0
    lines = out.read_text().splitlines()
    assert lines[0].startswith("# track 91") and len([l for l in lines if l.startswith("https://")]) == 3
    assert main(["--site-id", "x", "--event", "e", "--bbox", "90.8", "24.3", "91.8", "25.2", "--pol", "HHHH", "--threshold-db", "-3"]) == 2
    assert "give --files and/or --files-from" in capsys.readouterr().err
