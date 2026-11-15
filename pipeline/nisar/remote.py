"""Read an HDF5 granule straight from a NASA/ASF https URL using HTTP Range requests (no full download).

Why: a NISAR GCOV file is ~1.3 GB, but a flood AOI needs a small window. The files are chunked + compressed, so h5py only asks for the
chunks it needs and this file-like object turns each into a Range request (cached in large blocks).

Safety (same rules as download.py): https only; initial URL must be on the NASA/ASF host allow-list; the Earthdata token is read from
EARTHDATA_TOKEN and is never logged; the token is dropped on redirects to other hosts (S3 pre-signed URLs reject extra auth).
NOT VERIFIED against live NASA servers in the authoring environment (no network): verified only against a local Range server.
"""
from __future__ import annotations
import io, re, time
from collections import OrderedDict
from contextlib import contextmanager
from urllib.parse import urlparse
import h5py
import requests
from ..config import EarthdataAuth, load_auth
from .download import _EarthdataSession, CONNECT_READ_TIMEOUT

ALLOWED_HOSTS = ("asf.alaska.edu", "earthdata.nasa.gov", "earthdatacloud.nasa.gov")
MiB = 1 << 20


class RemoteError(OSError):
    """Message is safe to show to users (never contains the token)."""


def is_url(src) -> bool:
    return str(src).lower().startswith(("http://", "https://"))


def check_remote_url(url: str, allow_hosts=ALLOWED_HOSTS, allow_http: bool = False) -> str:
    u = urlparse(url)
    if not u.hostname or u.scheme not in (("https", "http") if allow_http else ("https",)):
        raise RemoteError("remote granule URL must be https")
    if not any(u.hostname == h or u.hostname.endswith("." + h) for h in allow_hosts):
        raise RemoteError(f"refusing to send Earthdata credentials to host '{u.hostname}' (not NASA/ASF)")
    return url


class RemoteFile(io.RawIOBase):
    """Seekable read-only file over HTTP Range requests with an LRU block cache."""

    def __init__(self, url: str, session, *, block_size: int = 8 * MiB, max_blocks: int = 32, timeout=CONNECT_READ_TIMEOUT,
                 retries: int = 2, sleep=time.sleep):
        super().__init__()
        self.url, self.s, self.bs, self.max_blocks, self.timeout, self.retries, self.sleep = url, session, block_size, max_blocks, timeout, retries, sleep
        self._pos = 0; self._blocks: OrderedDict[int, bytes] = OrderedDict()
        self.bytes_fetched = 0; self.requests_made = 0
        _, self.size = self._get(0, 0)

    def _get(self, start: int, end: int):
        last = "unknown error"
        for attempt in range(self.retries + 1):
            try:
                with self.s.get(self.url, headers={"Range": f"bytes={start}-{end}"}, stream=True, timeout=self.timeout, allow_redirects=True) as r:
                    self.requests_made += 1
                    sc = r.status_code
                    if sc in (401, 403):
                        raise RemoteError("Earthdata rejected the token (expired/invalid, or the ASF DAAC application/EULA is not approved for your account)")
                    if sc == 404: raise RemoteError("granule not found at the given URL")
                    if sc >= 500 or sc == 429:
                        last = f"server returned HTTP {sc}"; self.sleep(2 ** attempt); continue
                    if sc == 200:
                        raise RemoteError("the server ignored the Range request (would download the whole file); use a normal download for this URL")
                    if sc != 206: raise RemoteError(f"unexpected HTTP {sc}")
                    if "text/html" in r.headers.get("Content-Type", ""):
                        raise RemoteError("received an HTML page instead of data; credentials were not accepted")
                    m = re.match(r"bytes (\d+)-(\d+)/(\d+)", r.headers.get("Content-Range", ""))
                    if not m: raise RemoteError("server did not return a valid Content-Range")
                    data = r.content
                    if len(data) != int(m.group(2)) - int(m.group(1)) + 1:
                        last = "short read"; self.sleep(2 ** attempt); continue
                    self.bytes_fetched += len(data)
                    return data, int(m.group(3))
            except requests.Timeout: last = "timeout"; self.sleep(2 ** attempt)
            except requests.RequestException: last = "network error"; self.sleep(2 ** attempt)
        raise RemoteError(f"remote read failed after {self.retries + 1} attempts: {last}")

    def _block(self, i: int) -> bytes:
        if i in self._blocks:
            self._blocks.move_to_end(i); return self._blocks[i]
        start = i * self.bs
        data, _ = self._get(start, min(start + self.bs, self.size) - 1)
        self._blocks[i] = data
        while len(self._blocks) > self.max_blocks: self._blocks.popitem(last=False)
        return data

    def readable(self): return True
    def seekable(self): return True
    def writable(self): return False
    def tell(self): return self._pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._pos, io.SEEK_END: self.size}[whence]
        if base + offset < 0: raise ValueError("negative seek position")
        self._pos = base + offset
        return self._pos

    def readinto(self, b) -> int:
        n = min(len(b), max(0, self.size - self._pos))
        out = memoryview(b); got = 0
        while got < n:
            i, off = divmod(self._pos, self.bs)
            chunk = self._block(i)[off:off + (n - got)]
            if not chunk: break
            out[got:got + len(chunk)] = chunk; got += len(chunk); self._pos += len(chunk)
        return got

    def describe(self) -> str:
        return f"streamed {self.bytes_fetched / MiB:.0f} MB in {self.requests_made} requests (file {self.size / MiB:.0f} MB)"


@contextmanager
def open_h5(src, *, auth: EarthdataAuth | None = None, session=None, allow_hosts=ALLOWED_HOSTS, allow_http=False,
            block_size: int = 8 * MiB):
    """Yield (h5py.File, RemoteFile | None) for a local path or an https URL."""
    if not is_url(src):
        with h5py.File(src, "r") as f:
            yield f, None
        return
    check_remote_url(str(src), allow_hosts, allow_http)
    auth = auth or load_auth()
    if session is None and not auth.available:
        raise RemoteError("Earthdata token not set. In PowerShell: $env:EARTHDATA_TOKEN = '<your token>' (create one in your Earthdata profile)")
    s = session or _EarthdataSession(auth)
    rf = RemoteFile(str(src), s, block_size=block_size)
    try:
        with h5py.File(rf, "r") as f:
            yield f, rf
    finally:
        rf.close()
        if session is None: s.close()
