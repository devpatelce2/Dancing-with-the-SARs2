"""Process ONE before/after GCOV pair into public/data/<site_id>/.
python -m pipeline.run_site --site-id my-site --name "My site" --event "Event name" --country IN \
   --before before.h5 --after after.h5 --bbox W S E N --pol HHHH --threshold-db -3 [--out public/data]
Inputs are real files you downloaded; the pipeline never fabricates data."""
from __future__ import annotations
import argparse, sys
from pathlib import Path
from .nisar.gcov_reader import read_layer, GcovFormatError
from .processing import change as ch
from .processing.export import export_site, update_sites_index


def process(*, before_path, after_path, bbox, polarization, params: ch.ChangeParams, out_root: Path, site: dict,
            frequency=None, epsg_override=None, before_time=None, after_time=None, before_id=None, after_id=None,
            exclude_masks=(), downsample=1):
    L1 = read_layer(before_path, polarization, frequency, epsg_override, before_time, bbox_lonlat=bbox, downsample=downsample)
    L2 = read_layer(after_path, polarization, frequency, epsg_override, after_time, bbox_lonlat=bbox, downsample=downsample)
    for nm, L, t in (("before", L1, before_time), ("after", L2, after_time)):
        if not L.start_time: raise GcovFormatError(f"{nm}: acquisition time not found in file; pass it explicitly (from the catalogue)")
    if L1.polarization != L2.polarization or L1.frequency != L2.frequency:
        raise ch.AlignmentError("before/after polarization or frequency differ; refusing to compare")
    d1, t1 = ch.crop_to_bbox(L1.data, L1.transform, L1.epsg, bbox)
    d2, t2 = ch.crop_to_bbox(L2.data, L2.transform, L2.epsg, bbox)
    d2a, resampled = ch.align_to(d2, t2, L2.epsg, d1.shape, t1, L1.epsg)
    excl, mask_names, mnotes = None, [], []
    for mp in exclude_masks:
        m = ch.load_exclude_mask(mp, d1.shape, t1, L1.epsg)
        excl = m if excl is None else (excl | m)
        mask_names.append(Path(mp).name); mnotes.append(f"mask '{Path(mp).name}' excluded {int(m.sum())} px")
    res = ch.detect(d1, d2a, params, exclude_mask=excl)
    poly, area = ch.polygonize(res["candidate"], t1, L1.epsg)
    site = {**site, "aoi": {"type": "bbox", "bboxLonLat": list(bbox)}}
    meta = export_site(out_root / site["siteId"], site=site,
                       before={"productId": before_id or Path(before_path).stem, "acquisitionTime": L1.start_time, "polarization": L1.polarization, "frequency": L1.frequency, "units": L1.units_attr},
                       after={"productId": after_id or Path(after_path).stem, "acquisitionTime": L2.start_time, "polarization": L2.polarization, "frequency": L2.frequency},
                       result=res, transform=t1, epsg=L1.epsg, params=params, polygons=poly, area_km2=area, align_resampled=resampled,
                       notes=L1.notes + L2.notes + mnotes, masks=mask_names)
    update_sites_index(out_root, site["siteId"], site.get("name", site["siteId"]))
    return meta


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-id", required=True); ap.add_argument("--name"); ap.add_argument("--event", required=True); ap.add_argument("--country")
    ap.add_argument("--before", required=True); ap.add_argument("--after", required=True)
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--pol", required=True, help="e.g. HHHH (see hdf5_inspect / available_layers)"); ap.add_argument("--frequency")
    ap.add_argument("--threshold-db", type=float, required=True); ap.add_argument("--speckle-window", type=int, default=3)
    ap.add_argument("--min-pixels", type=int, default=9); ap.add_argument("--after-max-db", type=float)
    ap.add_argument("--epsg", type=int); ap.add_argument("--before-time"); ap.add_argument("--after-time")
    ap.add_argument("--exclude-mask", action="append", default=[], help="GeoTIFF; non-zero = excluded (permanent water, steep slope). Repeatable.")
    ap.add_argument("--before-id"); ap.add_argument("--after-id"); ap.add_argument("--out", default="public/data")
    a = ap.parse_args(argv)
    try:
        params = ch.ChangeParams(a.threshold_db, a.speckle_window, a.min_pixels, a.after_max_db)
        meta = process(before_path=a.before, after_path=a.after, bbox=tuple(a.bbox), polarization=a.pol, params=params, out_root=Path(a.out),
                       site={"siteId": a.site_id, "name": a.name or a.site_id, "eventName": a.event, "country": a.country},
                       frequency=a.frequency, epsg_override=a.epsg, before_time=a.before_time, after_time=a.after_time,
                       before_id=a.before_id, after_id=a.after_id, exclude_masks=a.exclude_mask)
    except (GcovFormatError, ch.AlignmentError, ValueError, OSError) as e:
        print(f"ERROR: {e}", file=sys.stderr); return 2
    print(f"OK: {meta['stats']['affectedAreaKm2']} km2 flood candidates, {meta['stats']['changedPixels']} px -> {Path(a.out)/a.site_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
