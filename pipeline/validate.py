"""Score SAR change candidates against an independent reference and record the result with the site.

Time-series site (public/data/<id>/timeseries.json):
  python -m pipeline.validate --site-dir public/data/sylhet --sar-date 2026-07-14 --reference water_20260715.tif \\
     --reference-baseline water_20260924.tif --name "OPERA DSWx-HLS" --source "NASA/JPL via Earthdata" --date 2026-07-15
  --reference may be a raster (any CRS) or a GeoJSON of flood polygons in EPSG:4326.
  --water-values: raster values that mean water (default 1 2 3); --invalid-min: values at or above this are ignored (default 250).
Single before/after pair site (meta.json + candidate.tif):
  python -m pipeline.validate --site-dir public/data/<id> --reference ref.tif --name "..." --source "..." --date YYYY-MM-DD
Nothing is fabricated: without a real reference file there is no validation."""
import argparse, sys
from pathlib import Path
from .validation.metrics import validate_site, validate_timeseries


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-dir", required=True); ap.add_argument("--reference", required=True)
    ap.add_argument("--name", required=True); ap.add_argument("--source", required=True); ap.add_argument("--date", required=True, help="reference acquisition date YYYY-MM-DD")
    ap.add_argument("--sar-date", help="YYYY-MM-DD of the time-series scene to score (time-series sites)")
    ap.add_argument("--reference-baseline", help="same reference product for a dry/baseline date, so only NEW water is compared")
    ap.add_argument("--water-values", nargs="*", type=int, default=[1, 2, 3]); ap.add_argument("--invalid-min", type=float, default=250)
    ap.add_argument("--notes", default="")
    a = ap.parse_args(argv); d = Path(a.site_dir)
    try:
        if (d / "timeseries.json").is_file():
            if not a.sar_date: raise ValueError("--sar-date is required for a time-series site")
            b = validate_timeseries(d, a.sar_date, a.reference, reference_name=a.name, reference_source=a.source, reference_date=a.date,
                                    reference_baseline_path=a.reference_baseline, water_values=tuple(a.water_values), invalid_min=a.invalid_min, notes=a.notes)
            print(f"reference values on the site grid: {b['referenceValues']} (water = {b['waterValues']})")
        else:
            b = validate_site(d, a.reference, reference_name=a.name, reference_source=a.source, reference_date=a.date, notes=a.notes)
    except (ValueError, OSError, KeyError) as e:
        print(f"ERROR: {e}", file=sys.stderr); return 2
    m = b["metrics"]; f = lambda v: "n/a" if v is None else f"{v:.3f}"
    print(f"OK: {m['pixelsCompared']} pixels compared | precision {f(m['precision'])} | recall {f(m['recall'])} | F1 {f(m['f1'])} | IoU {f(m['iou'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
