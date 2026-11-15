"""Server-side configuration. Credentials come from environment variables only and are never logged."""
from __future__ import annotations
import os
from dataclasses import dataclass

ASF_SEARCH_URL = "https://api.daac.asf.alaska.edu/services/search/param"
REQUEST_TIMEOUT_S = 30


@dataclass(frozen=True)
class EarthdataAuth:
    token: str | None
    username: str | None
    password: str | None

    @property
    def available(self) -> bool:
        return bool(self.token or (self.username and self.password))

    def __repr__(self) -> str:  # never leak secrets through logs/tracebacks
        return f"EarthdataAuth(available={self.available})"


def load_auth(env: dict | None = None) -> EarthdataAuth:
    e = os.environ if env is None else env
    return EarthdataAuth(
        token=(e.get("EARTHDATA_TOKEN") or None),
        username=(e.get("EARTHDATA_USERNAME") or None),
        password=(e.get("EARTHDATA_PASSWORD") or None),
    )
