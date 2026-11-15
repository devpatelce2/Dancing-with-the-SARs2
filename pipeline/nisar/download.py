"""Authenticated granule download from ASF DAAC using NASA Earthdata Login (server/local side ONLY).

NOT VERIFIED LIVE in the authoring environment (no network/credentials). Behaviour is unit-tested with fakes only.
Safety: https only; host allow-list (so credentials can never be sent to an arbitrary URL); no credentials in logs/exceptions;
streamed to <name>.part then renamed after size check; explicit timeouts; bounded retries for transient errors.
Auth: EARTHDATA_TOKEN (Bearer) preferred, else EARTHDATA_USERNAME/PASSWORD via the Earthdata redirect pattern.
"""
from __future__ import annotations
import re, time
from pathlib import Path
from urllib.parse import urlparse
import requests
from ..config import EarthdataAuth, load_auth

ALLOWED_HOST_SUFFIXES = ("asf.alaska.edu", "earthdata.nasa.gov", "earthdatacloud.nasa.gov")  # earthdatacloud: nisar.asf.earthdatacloud.nasa.gov
AUTH_HOSTS = ("urs.earthdata.nasa.gov",)
CONNECT_READ_TIMEOUT = (15, 120)
CHUNK = 1024 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,200}$")


class DownloadError(RuntimeError):
    """Message is safe to show to users (never contains credentials or local paths beyond the file name)."""


def check_url(url: str) -> str:
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname:
        raise DownloadError("download URL must be https")
    if not any(u.hostname == s or u.hostname.endswith("." + s) for s in ALLOWED_HOST_SUFFIXES):
        raise DownloadError(f"refusing to send Earthdata credentials to non-NASA/ASF host '{u.hostname}'")
    return url


class _EarthdataSession(requests.Session):
    """Keeps Basic auth only for URS hosts and the original host across redirects; never for other hosts."""
    def __init__(self, auth: EarthdataAuth):
        super().__init__(); self._ed = auth; self.trust_env = False
        if auth.token: self.headers["Authorization"] = f"Bearer {auth.token}"
    
    def rebuild_auth(self, prepared_request, response):
        """Preserve Bearer authentication only across trusted NASA/ASF hosts."""

        host = (urlparse(prepared_request.url).hostname or "").lower()

        trusted_host = any(
            host == suffix or host.endswith("." + suffix)
            for suffix in ALLOWED_HOST_SUFFIXES
        )

        # Bearer token authentication
        if self._ed.token:
            if trusted_host:
                prepared_request.headers["Authorization"] = (
                    f"Bearer {self._ed.token}"
                )
            else:
                prepared_request.headers.pop("Authorization", None)
            return

        # Basic authentication: only send credentials to Earthdata Login
        prepared_request.headers.pop("Authorization", None)

        if (
            self._ed.username
            and self._ed.password
            and host in AUTH_HOSTS
        ):
            prepared_request.prepare_auth(
                (self._ed.username, self._ed.password)
            )



def download_granule(url: str, dest_dir: Path, filename: str, *, expected_bytes: int | None = None,
                     auth: EarthdataAuth | None = None, session=None, retries: int = 2, sleep=time.sleep) -> Path:
    check_url(url)
    if not SAFE_NAME.match(filename): raise DownloadError("unsafe file name")
    auth = auth or load_auth()
    if not auth.available: raise DownloadError("Earthdata credentials are not configured (set EARTHDATA_TOKEN or EARTHDATA_USERNAME/PASSWORD)")
    dest_dir.mkdir(parents=True, exist_ok=True)
    final, part = dest_dir / filename, dest_dir / (filename + ".part")
    if final.is_file() and (expected_bytes is None or final.stat().st_size == expected_bytes): return final
    s = session or _EarthdataSession(auth)
    last = "unknown error"
    for attempt in range(retries + 1):
        try:
            with s.get(url, stream=True, timeout=CONNECT_READ_TIMEOUT, allow_redirects=True) as r:
                if r.status_code in (401, 403):
                    raise DownloadError("Earthdata rejected the credentials/token (expired token or EULA/application not approved for ASF DAAC)")
                if r.status_code == 404: raise DownloadError("granule not found at the given URL")
                if r.status_code >= 500 or r.status_code == 429:
                    last = f"server returned HTTP {r.status_code}"; sleep(2 ** attempt); continue
                if r.status_code != 200: raise DownloadError(f"unexpected HTTP {r.status_code}")
                if "text/html" in r.headers.get("Content-Type", ""):
                    raise DownloadError("received an HTML login page instead of data; credentials were not accepted")
                n = 0
                with open(part, "wb") as fh:
                    for chunk in r.iter_content(CHUNK):
                        if chunk: fh.write(chunk); n += len(chunk)
            if expected_bytes is not None and n != expected_bytes:
                part.unlink(missing_ok=True); last = f"size mismatch ({n} != {expected_bytes})"; sleep(2 ** attempt); continue
            part.replace(final); return final
        except requests.Timeout: last = "timeout"; sleep(2 ** attempt)
        except requests.RequestException: last = "network error"; sleep(2 ** attempt)
    part.unlink(missing_ok=True)
    raise DownloadError(f"download failed after {retries + 1} attempts: {last}")


def main(argv=None) -> int:
    """python -m pipeline.nisar.download --url <https asf url from catalogue> --out data-raw [--bytes N]"""
    import argparse, sys
    ap = argparse.ArgumentParser(); ap.add_argument("--url", required=True); ap.add_argument("--out", default="data-raw"); ap.add_argument("--bytes", type=int)
    a = ap.parse_args(argv)
    name = urlparse(a.url).path.rsplit("/", 1)[-1]
    try: p = download_granule(a.url, Path(a.out), name, expected_bytes=a.bytes)
    except DownloadError as e: print(f"ERROR: {e}", file=sys.stderr); return 2
    print(f"OK: {p.name} ({p.stat().st_size} bytes)"); return 0


if __name__ == "__main__":
    raise SystemExit(main())
