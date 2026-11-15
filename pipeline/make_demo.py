"""Write a clearly labelled SYNTHETIC demo site so the UI (chart, Compare tab, map overlays) can be tried before real data exists.

python -m pipeline.make_demo            -> public/data/synthetic-demo/   (the app shows a red "SYNTHETIC" badge)
python -m pipeline.make_demo --remove   -> deletes it again

These numbers are generated, NOT observed. Remove the demo before submitting or presenting results as science."""
from __future__ import annotations
import argparse, json, shutil, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
import h5py, numpy as np
from pyproj import Transformer
from .processing.timeseries import build_timeseries

SITE = "synthetic-demo"
EPSG, X0, Y0, STEP, NX, NY = 32646, 280000.0, 2790000.0, 100.0, 700, 800


def _scene(d: Path, cycle: int, when: datetime, flood: float, rng) -> str:
    yy, xx = np.mgrid[0:NY, 0:NX]
    base = 0.11 + 0.05 * np.sin(xx / 60.0) * np.cos(yy / 85.0)                       # textured "land"
    river = np.abs(xx - (330 + 70 * np.sin(yy / 110.0))) < 9                          # permanent water
    base[river] = 0.008
    p = base.copy()
    if flood > 0:                                                                     # flood grows outward from the river
        dist = np.abs(xx - (330 + 70 * np.sin(yy / 110.0)))
        wet = (dist < 9 + 150 * flood * (0.6 + 0.4 * np.sin(yy / 47.0) ** 2)) & (yy > 180) & (yy < 690)
        p[wet] = 0.012
    p = (p * rng.gamma(30, 1 / 30, size=p.shape)).astype("float32")
    stamp = when.strftime("%Y%m%dT%H%M%S")
    f = d / f"NISAR_L2_PR_GCOV_{cycle:03d}_999_D_999_4005_DHDH_A_{stamp}_{stamp}_SYNTH_N_F_J_001.h5"
    with h5py.File(f, "w") as h:
        g = h.create_group("science/LSAR/GCOV/grids/frequencyA")
        g.create_dataset("HHHH", data=p)
        g.create_dataset("xCoordinates", data=X0 + STEP * (np.arange(NX) + 0.5)); g.create_dataset("yCoordinates", data=Y0 - STEP * (np.arange(NY) + 0.5))
        pr = g.create_dataset("projection", data=np.uint32(EPSG)); pr.attrs["epsg_code"] = EPSG
    return str(f)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="public/data"); ap.add_argument("--remove", action="store_true")
    a = ap.parse_args(argv); out = Path(a.out)
    if a.remove:
        shutil.rmtree(out / SITE, ignore_errors=True)
        f = out / "sites.json"
        if f.is_file():
            idx = json.loads(f.read_text(encoding="utf-8")); idx["sites"] = [s for s in idx.get("sites", []) if s.get("id") != SITE]
            f.write_text(json.dumps(idx, indent=2), encoding="utf-8")
        print("OK: synthetic demo removed"); return 0
    rng = np.random.default_rng(7); t0 = datetime(2026, 6, 20, 12, 34, tzinfo=timezone.utc)
    flood = [0, 0, 0, 0, 0.55, 1.0, 0.8, 0.45, 0.15, 0, 0]
    inv = Transformer.from_crs(EPSG, 4326, always_xy=True)
    w, s = inv.transform(X0 + 2000, Y0 - NY * STEP + 2000); e, n = inv.transform(X0 + NX * STEP - 2000, Y0 - 2000)
    with tempfile.TemporaryDirectory() as td:
        files = [_scene(Path(td), 24 + i, t0 + timedelta(days=12 * i), fl, rng) for i, fl in enumerate(flood)]
        ts = build_timeseries(files=files, bbox=(w, s, e, n), polarization="HHHH", threshold_db=-3.0, out_root=out,
                              site={"siteId": SITE, "name": "SYNTHETIC demo (not real data)", "eventName": "generated flood pattern"},
                              frequency="frequencyA", event_date="2026-08-05", downsample=2, synthetic=True)
    print(f"OK: synthetic demo written to {out / SITE} ({ts['summary']['scenes']} generated scenes). Remove with: python -m pipeline.make_demo --remove")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
