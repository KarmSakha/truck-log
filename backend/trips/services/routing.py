"""OSRM routing: one request, 3 waypoints, per-leg split of the polyline."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import requests
from django.conf import settings

METERS_PER_MILE = 1609.344


@dataclass
class LegResult:
    miles: float
    minutes: float          # raw (unquantized) drive minutes
    coord_start: int        # index into the combined geometry
    coord_end: int
    directions: list = field(default_factory=list)


@dataclass
class RouteResult:
    geometry: list          # [[lng, lat], ...] combined
    legs: list              # [LegResult, LegResult]
    total_miles: float
    total_minutes: float


class RoutingError(Exception):
    pass


def fetch_route(points):
    """points: [(lat, lng), ...] for current -> pickup -> dropoff."""
    coords = ";".join(f"{lng},{lat}" for lat, lng in points)
    url = (f"{settings.OSRM_URL}/route/v1/driving/{coords}"
           f"?overview=full&geometries=geojson&steps=true"
           f"&annotations=distance,duration")
    try:
        r = requests.get(url, timeout=30,
                         headers={"User-Agent": settings.GEO_USER_AGENT})
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError) as e:
        raise RoutingError(f"route service unavailable: {e}") from e

    if data.get("code") != "Ok" or not data.get("routes"):
        raise RoutingError(f"no route: {data.get('code', 'unknown')}")

    route = data["routes"][0]
    geometry = route["geometry"]["coordinates"]  # [lng, lat]
    legs = []
    wp = data.get("waypoints", [])

    # Locate each via waypoint in the geometry to split legs.
    # waypoints[i] gives the snapped position of input point i.
    split_indices = [0]
    for i in range(1, len(points)):
        target = wp[i]["location"] if i < len(wp) else points[i][::-1]
        split_indices.append(_nearest_coord_index(geometry, target))

    osrm_legs = route["legs"]
    for i, osrm_leg in enumerate(osrm_legs):
        legs.append(LegResult(
            miles=osrm_leg["distance"] / METERS_PER_MILE,
            minutes=osrm_leg["duration"] / 60.0,
            coord_start=split_indices[i],
            coord_end=split_indices[i + 1],
            directions=[_direction(step) for step in osrm_leg.get("steps", [])],
        ))

    return RouteResult(
        geometry=geometry,
        legs=legs,
        total_miles=route["distance"] / METERS_PER_MILE,
        total_minutes=route["duration"] / 60.0,
    )


def _nearest_coord_index(geometry, target_lnglat):
    best_i, best_d = 0, float("inf")
    for i, c in enumerate(geometry):
        d = (c[0] - target_lnglat[0]) ** 2 + (c[1] - target_lnglat[1]) ** 2
        if d < best_d:
            best_d, best_i = d, i
    return best_i


def cumulative_distances(geometry):
    """Cumulative haversine miles along the polyline."""
    out = [0.0]
    for i in range(1, len(geometry)):
        out.append(out[-1] + _haversine(geometry[i - 1], geometry[i]))
    return out


def _haversine(a, b):
    lng1, lat1, lng2, lat2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def position_at_mile(geometry, cum_miles, mile):
    """Interpolate the polyline at `mile` cumulative route miles -> [lng,lat]."""
    if mile <= 0:
        return geometry[0]
    if mile >= cum_miles[-1]:
        return geometry[-1]
    # binary search
    lo, hi = 0, len(cum_miles) - 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if cum_miles[mid] <= mile:
            lo = mid
        else:
            hi = mid
    span = cum_miles[hi] - cum_miles[lo]
    f = 0.0 if span <= 0 else (mile - cum_miles[lo]) / span
    return [geometry[lo][0] + (geometry[hi][0] - geometry[lo][0]) * f,
            geometry[lo][1] + (geometry[hi][1] - geometry[lo][1]) * f]


def _direction(step):
    """Keep only display-safe navigation data from an OSRM maneuver."""
    maneuver = step.get("maneuver", {})
    kind = maneuver.get("type", "continue")
    modifier = maneuver.get("modifier", "").replace("_", " ")
    modifier = modifier.replace("slight ", "slightly ").replace("sharp ", "sharply ")
    road = step.get("name") or step.get("ref") or "the road"
    if modifier == "uturn":
        instruction = f"Make a U-turn onto {road}"
    elif kind == "depart":
        instruction = f"Start on {road}"
    elif kind == "arrive":
        instruction = "Arrive at your destination"
    elif kind in {"roundabout", "rotary", "roundabout turn"}:
        exit_number = maneuver.get("exit")
        instruction = (f"At the roundabout, take exit {exit_number} onto {road}"
                       if exit_number else f"Follow the roundabout onto {road}")
    elif kind == "new name":
        instruction = f"Continue onto {road}"
    else:
        verb = {"turn": "Turn", "fork": "Keep", "merge": "Merge",
                "on ramp": "Take the ramp", "off ramp": "Take the exit",
                "end of road": "At the end of the road, turn"}.get(kind, "Continue")
        instruction = f"{verb} {modifier} onto {road}".replace("  ", " ")
    return {"instruction": instruction,
            "miles": round(step.get("distance", 0) / METERS_PER_MILE, 2)}
