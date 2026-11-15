"""One-time live check of the Sentinel-1 (OPERA RTC-S1) path. Run it on a machine with internet before trusting a real analysis.

  python -m pipeline.check_sentinel1 --place "Noto, Ishikawa, Japan" --start 2023-12-14 --end 2024-02-15 --probe

Without --probe: metadata only (catalogue search + track/pass selection + the file URLs the pipeline will use).
With --probe (needs EARTHDATA_TOKEN): asks the server for the first 1 KB of the first backscatter file and its mask file, to confirm
the file-name convention and that your Earthdata account can download from ASF. Nothing large is downloaded."""
from __future__ import annotations
import argparse, sys
from urllib.parse import urlparse
from .config import load_auth
from .nisar import catalog
from .nisar.download import CONNECT_READ_TIMEOUT, _EarthdataSession, check_url
from .sentinel1 import catalog as s1


def probe(url: str, session, *, ranged: bool = True) -> str:
    """Ask for the first 1 KB (or just open the stream) and describe the answer, including every redirect hop (host + status; never headers/tokens)."""
    check_url(url)
    hdrs = {"Range": "bytes=0-1023"} if ranged else {}
    try:
        with session.get(url, headers=hdrs, stream=True, timeout=CONNECT_READ_TIMEOUT, allow_redirects=True) as r:
            hops = " -> ".join(f"{urlparse(h.url).hostname} {h.status_code}" for h in (getattr(r, "history", None) or []))
            chain = (hops + " -> " if hops else "") + f"{urlparse(getattr(r, 'url', url) or url).hostname} {r.status_code}"
            sc = r.status_code
            if sc in (200, 206):
                ok = "text/html" not in r.headers.get("Content-Type", "")
                return f"{'OK (file reachable)' if ok else 'PROBLEM: got an HTML login page (token not accepted)'}   [{chain}]"
            why = {401: "401: Earthdata did not accept the request. Most common cause: the 'Alaska Satellite Facility Data Access' application is not authorised "
                        "for your Earthdata account (Earthdata Login > Applications > Authorized Apps, and accept the ASF EULA), or the token was revoked",
                   403: "403: ASF DAAC application/EULA not approved for this account",
                   404: "404: file name convention differs from what the pipeline derives; send the URLs printed above to the developer"}.get(sc, f"HTTP {sc}")
            return f"PROBLEM: {why}   [{chain}]"
    except Exception as e:  # noqa: BLE001
        return f"PROBLEM: {type(e).__name__}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--place"); ap.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"))
    ap.add_argument("--half-deg", type=float, default=0.1); ap.add_argument("--start", required=True); ap.add_argument("--end")
    ap.add_argument("--pol", default="VV"); ap.add_argument("--probe", action="store_true")
    a = ap.parse_args(argv)
    bbox = a.bbox
    if a.place:
        from .geocode import place_to_bbox
        try: *bbox, shown = place_to_bbox(a.place, a.half_deg)
        except (ValueError, OSError) as e: print(f"ERROR: {e}", file=sys.stderr); return 2
        print(f"Place: {shown}\nBox (W S E N): {bbox}")
    if not bbox: print("ERROR: give --place or --bbox", file=sys.stderr); return 2
    try: res = catalog.search(tuple(bbox), a.start, a.end, "RTC", 250, dataset="OPERA-S1")
    except (catalog.CatalogError, ValueError) as e: print(f"ERROR: {e}", file=sys.stderr); return 2
    print(f"1. Catalogue: {res['usable']} OPERA RTC-S1 bursts over the box")
    if not res["usable"]: print("   PROBLEM: nothing found; widen the dates or the box", file=sys.stderr); return 1
    r0 = res["records"][0]
    print(f"   sample record: {r0['granuleId']}\n   burstId={r0['burstId']} path={r0['pathNumber']} direction={r0['flightDirection']} polarization={r0['polarization']}")
    print(f"   property names ASF returned: {', '.join(sorted(r0['raw']))}")
    print(f"   ASF url: {r0['raw'].get('url')}\n   ASF additionalUrls: {r0['raw'].get('additionalUrls')}\n   ASF s3Urls: {r0['raw'].get('s3Urls')}")
    lines, chosen, passes, why = s1.select(res["records"], tuple(bbox), a.pol)
    print("2. Tracks:\n" + "\n".join(lines))
    if chosen is None: print(f"   PROBLEM: {why}", file=sys.stderr); return 1
    print(f"   chosen track {chosen[0]} {chosen[1]}: {len(passes)} passes; first pass has {len(passes[0]['urls'])} burst file(s), box coverage {100 * passes[0]['cover']:.0f}%")
    url = passes[0]["urls"][0]; mask = s1.layer_url(passes[0]["records"][0], "mask")
    print(f"3. Files the pipeline will use:\n   data: {url}\n   mask: {mask}")
    if not a.probe: print("   (add --probe to test that these URLs download; needs EARTHDATA_TOKEN)"); return 0
    auth = load_auth()
    if not auth.available: print("   PROBLEM: EARTHDATA_TOKEN is not set", file=sys.stderr); return 1
    with _EarthdataSession(auth) as sess:
        print(f"4. Probe data file (with Range):    {probe(url, sess)}")
        print(f"   Probe data file (without Range): {probe(url, sess, ranged=False)}")
        print(f"   Probe mask file:                 {probe(mask, sess)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
