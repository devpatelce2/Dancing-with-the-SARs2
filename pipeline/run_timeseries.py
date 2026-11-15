"""Process a STACK of GCOV (NISAR) or OPERA RTC-S1 (Sentinel-1) scenes (same track) into public/data/<site_id>/timeseries.json + per-date overlays.

python -m pipeline.run_timeseries --site-id sylhet-2026 --name "Sylhet haor" --event "Monsoon flood" --country BD \
   --bbox 90.8 24.3 91.8 25.2 --pol HHHH --threshold-db -3 --event-date 2026-08-01 \
   --files data/*.h5
Inputs are real files you downloaded; nothing is fabricated. Use `python -m pipeline.nisar.hdf5_inspect <file>` first."""
from __future__ import annotations
import argparse, glob, sys
from pathlib import Path
from .nisar.gcov_reader import GcovFormatError
from .processing import change as ch
from .processing.timeseries import build_timeseries


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-id", required=True); ap.add_argument("--name"); ap.add_argument("--event", required=True); ap.add_argument("--country")
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--pol", required=True, help="NISAR: e.g. HHHH (DHDH scenes carry HHHH and HVHV). Sentinel-1: VV or VH")
    ap.add_argument("--mission", choices=["NISAR", "SENTINEL-1"], help="default: detected from the file names (OPERA RTC-S1 files = Sentinel-1)"); ap.add_argument("--frequency", default="frequencyA", help="default frequencyA (primary L-band, ~10 m). Real GCOV files also carry a coarse frequencyB.")
    ap.add_argument("--downsample", type=int, help="n x n block mean of linear power (default 8 for NISAR, 1 for Sentinel-1). For NISAR use 1 only for small boxes: a full-resolution 100 km box is ~100 M pixels per scene.")
    ap.add_argument("--threshold-db", type=float, required=True, help="negative; e.g. -3. Recorded in the output; no universal value.")
    ap.add_argument("--event-date", help="YYYY-MM-DD; scenes BEFORE this date form the baseline")
    ap.add_argument("--baseline-n", type=int, default=3); ap.add_argument("--speckle-window", type=int, default=3)
    ap.add_argument("--min-pixels", type=int, default=9); ap.add_argument("--epsg", type=int)
    ap.add_argument("--exclude-mask", action="append", default=[]); ap.add_argument("--allow-mixed-tracks", action="store_true")
    ap.add_argument("--files", nargs="+", default=[], help="HDF5 files or https URLs (globs allowed). URLs are STREAMED: only your box is read (needs EARTHDATA_TOKEN).")
    ap.add_argument("--files-from", help="text file with one path/URL per line (see pipeline.find_scenes); lines starting with # are ignored")
    ap.add_argument("--out", default="public/data")
    a = ap.parse_args(argv)
    names = list(a.files)
    if a.files_from:
        names += [l.strip() for l in Path(a.files_from).read_text(encoding="utf-8").splitlines() if l.strip() and not l.lstrip().startswith("#")]
    if not names:
        print("ERROR: give --files and/or --files-from", file=sys.stderr); return 2
    files = sorted({f for pat in names for f in (([pat] if pat.lower().startswith("http") else glob.glob(pat)) or [pat])})
    try:
        ts = build_timeseries(files=files, bbox=tuple(a.bbox), polarization=a.pol, threshold_db=a.threshold_db, out_root=Path(a.out),
                              site={"siteId": a.site_id, "name": a.name or a.site_id, "eventName": a.event, "country": a.country},
                              frequency=a.frequency, epsg_override=a.epsg, event_date=a.event_date, baseline_n=a.baseline_n,
                              speckle_window=a.speckle_window, min_pixels=a.min_pixels, allow_mixed_tracks=a.allow_mixed_tracks, downsample=a.downsample,
                              exclude_masks=a.exclude_mask, mission=a.mission)
    except (GcovFormatError, ch.AlignmentError, ValueError, OSError) as e:
        print(f"ERROR: {e}", file=sys.stderr); return 2
    s = ts["summary"]
    print(f"OK: {s['scenes']} scenes {s['firstTime'][:10]}..{s['lastTime'][:10]}; peak changed area {s['peakChangedAreaKm2']} km2 on "
          f"{s['peakChangedAreaTime'][:10]}; largest drop {s['largestDropDb']} dB -> {Path(a.out)/a.site_id/'timeseries.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
