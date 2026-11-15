"""Quick check of ONE scene (local .h5 path OR https URL). python check_scene.py <file-or-url> W S E N
For a URL set EARTHDATA_TOKEN first; only your box is streamed (see the 'streamed ... MB' note)."""
import sys, numpy as np
from pipeline.nisar.gcov_reader import read_layer, GcovFormatError

f = sys.argv[1]; bbox = tuple(map(float, sys.argv[2:6]))
try:
    L = read_layer(f, "HHHH", "frequencyA", bbox_lonlat=bbox, downsample=8)
except (GcovFormatError, OSError) as e:
    print("ERROR:", e); raise SystemExit(1)
d = L.data; ok = np.isfinite(d)
print("pixels:", d.shape, "| pixel size (m):", abs(L.transform.a), "| valid %:", round(100 * ok.mean(), 1))
if ok.any():
    p2, p98 = np.nanpercentile(d, [2, 98])
    print("mean dB:", round(float(10 * np.log10(d[ok].mean())), 2), "| 2%-98% dB:", round(float(10 * np.log10(p2)), 1), "to", round(float(10 * np.log10(p98)), 1))
print("start time:", L.start_time, "| EPSG:", L.epsg)
print("notes:", L.notes)
