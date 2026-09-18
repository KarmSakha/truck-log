"""Geocoding: Nominatim primary, Photon (komoot) fallback.

Nominatim usage policy: <=1 req/s, identifying UA + Referer, and no
autocomplete / search-as-you-type, so typeahead goes to Photon only.
Nominatim is used for the single forward geocode on submit and for
reverse lookups. Results are cached in the DB so repeat demo trips and
repeat keystrokes don't re-hit the services.
"""

from __future__ import annotations

import fcntl
import os
import tempfile
import time
from dataclasses import dataclass

import requests
from django.conf import settings
from django.utils import timezone

from trips.models import GeocodeCache

_US_STATE_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "district of columbia": "DC", "florida": "FL",
    "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY",
    "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY",
}

PHOTON_URL = "https://photon.komoot.io"

# (lock name, min seconds between calls) per host, shared by all workers.
NOMINATIM = ("nominatim", 1.05)
PHOTON = ("photon", 0.25)


def _throttle(name, interval):
    """Space calls to one host >= `interval` s apart across processes.

    A lock file per host (in the temp dir) holds the last call's wall-clock
    time; the flock is held while sleeping, so gunicorn workers queue up.
    """
    path = os.path.join(tempfile.gettempdir(), f"hosdesk-geo-{name}.lock")
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    with os.fdopen(fd, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            try:
                last = float(f.read().strip() or 0)
            except ValueError:
                last = 0.0
            # clamp: a clock step backwards must not stall the worker
            wait = min(interval, interval - (time.time() - last))
            if wait > 0:
                time.sleep(wait)
            f.seek(0)
            f.truncate()
            f.write(repr(time.time()))
            f.flush()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _get(url, params, host, referer=None):
    _throttle(*host)
    headers = {"User-Agent": settings.GEO_USER_AGENT,
               "Accept-Language": "en"}
    if referer:
        headers["Referer"] = referer
    r = requests.get(url, params=params, headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


@dataclass
class Place:
    lat: float
    lng: float
    city: str
    state: str          # USPS abbreviation
    display: str        # "City, ST" short label
    raw: dict


def _city_of(addr: dict) -> str:
    for k in ("city", "town", "village", "hamlet", "municipality", "county"):
        if addr.get(k):
            return addr[k]
    return ""


def _state_abbr(addr: dict) -> str:
    code = addr.get("ISO3166-2-lvl4", "")
    if "-" in code:
        return code.split("-")[-1]
    return _US_STATE_ABBR.get((addr.get("state") or "").lower(),
                            addr.get("state", ""))


# -- Nominatim ---------------------------------------------------------------

def _nom_search(query, limit=5):
    return _get(f"{settings.NOMINATIM_URL}/search", {
        "q": query, "format": "jsonv2", "countrycodes": "us",
        "limit": limit, "addressdetails": 1}, NOMINATIM,
        referer=settings.GEO_REFERER)


def _nom_reverse(lat, lng):
    return _get(f"{settings.NOMINATIM_URL}/reverse", {
        "lat": lat, "lon": lng, "format": "jsonv2",
        "zoom": 10, "addressdetails": 1}, NOMINATIM,
        referer=settings.GEO_REFERER)


def _nom_to_place(r, fallback=""):
    addr = r.get("address") or {}
    city = _city_of(addr) or r.get("name") or fallback
    state = _state_abbr(addr)
    return Place(lat=float(r["lat"]), lng=float(r["lon"]), city=city,
                 state=state,
                 display=f"{city}, {state}" if state else city, raw=addr)


# -- Photon (fallback; sole typeahead provider) ---------------------------------

def _photon_search(query, limit=5):
    data = _get(f"{PHOTON_URL}/api/", {"q": query, "limit": limit, "lang": "en"},
                PHOTON)
    out = []
    for f in data.get("features", []):
        p = f.get("properties", {})
        if p.get("countrycode", "US").upper() not in ("US", "USA"):
            continue
        addr = {"city": p.get("city") or p.get("name"),
                "state": p.get("state")}
        out.append({
            "lat": f["geometry"]["coordinates"][1],
            "lon": f["geometry"]["coordinates"][0],
            "address": addr,
            "display_name": ", ".join(x for x in [
                p.get("name"), p.get("city"), p.get("state"),
                p.get("country")] if x),
        })
    return out


def _photon_reverse(lat, lng):
    data = _get(f"{PHOTON_URL}/reverse", {"lat": lat, "lon": lng, "lang": "en"},
                PHOTON)
    feats = data.get("features") or []
    if not feats:
        return {}
    p = feats[0].get("properties", {})
    return {"lat": lat, "lon": lng,
            "address": {"city": p.get("city") or p.get("name")
                        or p.get("county"),
                        "state": p.get("state")}}


def _photon_to_place(r, fallback=""):
    addr = r.get("address") or {}
    city = _city_of(addr) or fallback
    state = _US_STATE_ABBR.get((addr.get("state") or "").lower(),
                             addr.get("state", ""))
    return Place(lat=float(r.get("lat", 0)), lng=float(r.get("lon", 0)),
                 city=city, state=state,
                 display=f"{city}, {state}" if state else city, raw=addr)


# -- public API ----------------------------------------------------------------

def geocode(query: str) -> Place | None:
    key = "geo:fwd:" + " ".join(query.lower().split())
    hit = GeocodeCache.objects.filter(key=key).first()
    if hit:
        return Place(**hit.payload)

    place = None
    try:
        results = _nom_search(query, limit=1)
        if results:
            place = _nom_to_place(results[0], fallback=query)
    except requests.RequestException:
        pass
    if place is None:
        try:
            results = _photon_search(query, limit=1)
            if results:
                place = _photon_to_place(results[0], fallback=query)
        except requests.RequestException:
            pass
    if place:
        GeocodeCache.objects.update_or_create(
            key=key, defaults={"payload": place.__dict__,
                               "created_at": timezone.now()})
    return place


def autocomplete(query: str, limit: int = 5):
    """Typeahead suggestions from Photon only (Nominatim forbids autocomplete).

    Raises on provider failure so the caller can tell it from "no matches".
    """
    key = "geo:ac:" + " ".join(query.lower().split())
    hit = GeocodeCache.objects.filter(key=key).first()
    if hit:
        return hit.payload
    # over-fetch: non-US features are dropped by _photon_search
    results = _photon_search(query, limit=limit * 3)[:limit]
    out = [{"lat": r["lat"], "lng": r["lon"], "label": r["display_name"],
            "city": _city_of(r["address"]),
            "state": _photon_to_place(r).state}
           for r in results]
    GeocodeCache.objects.update_or_create(
        key=key, defaults={"payload": out, "created_at": timezone.now()})
    return out


def reverse(lat: float, lng: float) -> Place | None:
    key = f"geo:rev:{lat:.3f},{lng:.3f}"
    hit = GeocodeCache.objects.filter(key=key).first()
    if hit:
        return Place(**hit.payload)
    place = None
    try:
        r = _nom_reverse(lat, lng)
        addr = r.get("address") or {}
        if _city_of(addr):
            place = _nom_to_place(r)
    except requests.RequestException:
        pass
    if place is None:
        try:
            r = _photon_reverse(lat, lng)
            if r.get("address"):
                place = _photon_to_place(r)
                place.lat, place.lng = lat, lng
        except requests.RequestException:
            pass
    if place:
        GeocodeCache.objects.update_or_create(
            key=key, defaults={"payload": place.__dict__,
                               "created_at": timezone.now()})
    return place
