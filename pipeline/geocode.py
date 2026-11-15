"""Place name -> lat/lon using OpenStreetMap Nominatim, with fallbacks so natural features
(peninsulas, gulfs, ranges) and names with a country suffix still resolve. Needs internet."""
from __future__ import annotations
import re
import requests

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OPEN_METEO = "https://geocoding-api.open-meteo.com/v1/search"
HEADERS = {"User-Agent": "dancing-with-the-sars/0.1 (student project)", "Accept-Language": "en"}

# Generic words that often stop a name matching (OSM may store "Noto" or the Japanese name only).
FEATURE_WORDS = re.compile(r"\b(peninsula|region|area|district|province|prefecture|gulf|bay|island|islands|city)\b", re.I)


def _variants(place: str) -> list[str]:
    """Query variants, most specific first: as typed, without feature words, name only, name + country."""
    place = " ".join(place.split())
    parts = [p.strip() for p in place.split(",") if p.strip()]
    out = [place]
    if parts:
        name, country = parts[0], (parts[-1] if len(parts) > 1 else "")
        bare = FEATURE_WORDS.sub("", name).strip()
        if bare and bare.lower() != name.lower():
            out.append(f"{bare}, {country}" if country else bare)
        out.append(name)
        if bare and bare.lower() != name.lower():
            out.append(bare)
    seen, uniq = set(), []
    for v in out:
        if v and v.lower() not in seen:
            seen.add(v.lower()); uniq.append(v)
    return uniq


def _nominatim(q: str, s) -> tuple[float, float, str] | None:
    r = s.get(NOMINATIM, params={"q": q, "format": "json", "limit": 1, "accept-language": "en"}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    hits = r.json()
    if not hits:
        return None
    return float(hits[0]["lat"]), float(hits[0]["lon"]), hits[0].get("display_name", q)


def _open_meteo(q: str, s) -> tuple[float, float, str] | None:
    """Second geocoder (GeoNames-based, no key). Takes a bare place name, so drop the country part."""
    name = q.split(",")[0].strip()
    r = s.get(OPEN_METEO, params={"name": name, "count": 1, "language": "en", "format": "json"}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    hits = r.json().get("results") or []
    if not hits:
        return None
    h = hits[0]
    label = ", ".join(x for x in (h.get("name"), h.get("admin1"), h.get("country")) if x)
    return float(h["latitude"]), float(h["longitude"]), label or q


def geocode(place: str, session=None):
    """Return (lat, lon, display_name). Raises ValueError if no geocoder knows the place."""
    s = session or requests
    last_err = None
    for q in _variants(place):
        try:
            hit = _nominatim(q, s)
            if hit: return hit
        except requests.RequestException as e:
            last_err = e
    for q in _variants(place):
        try:
            hit = _open_meteo(q, s)
            if hit: return hit
        except requests.RequestException as e:
            last_err = e
    if last_err is not None:
        raise last_err  # every lookup failed on the network: report "geocoder unavailable", not "not found"
    raise ValueError(f"place not found: {place!r}; try a nearby town or add the country")


def place_to_bbox(place: str, half_deg: float = 0.1, session=None):
    """Return (W, S, E, N, display_name): a box of 2*half_deg centred on the place."""
    lat, lon, name = geocode(place, session)
    return (round(lon - half_deg, 4), round(lat - half_deg, 4), round(lon + half_deg, 4), round(lat + half_deg, 4), name)
