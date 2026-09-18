import json
import math
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, available_timezones

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .models import Trip
from .planner.core import DAY, STEP, ceil_quarter, plan_trip, quantize_minutes
from .planner.days import build_day_logs
from .services import geocode, routing

US_TIMEZONES = {
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
    "Pacific/Honolulu",
}

LOCATION_MAX = 200
META_MAX = 80
START_TIME_RE = re.compile(r"([01]?\d|2[0-3]):([0-5]\d)", re.ASCII)


def _err(status, field, msg):
    return JsonResponse({"error": msg, "field": field}, status=status)


@require_GET
def geocode_search(request):
    """Typeahead proxy: GET /api/geocode/?q=..."""
    q = (request.GET.get("q") or "").strip()[:LOCATION_MAX]
    if len(q) < 3:
        return JsonResponse({"results": []})
    try:
        return JsonResponse({"results": geocode.autocomplete(q)})
    except Exception:
        # 502, not an empty 200, so the UI can tell "failed" from "no matches"
        return JsonResponse(
            {"results": [], "error": "Place search is unavailable"}, status=502)


@require_GET
def trip_detail(request, trip_id):
    try:
        trip = Trip.objects.get(id=trip_id)
    except (Trip.DoesNotExist, ValueError):
        return _err(404, "trip", "Trip not found")
    return JsonResponse(trip.result)


@csrf_exempt
@require_POST
def trip_create(request):
    try:
        body = json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _err(400, "body", "Invalid JSON")
    if not isinstance(body, dict):
        return _err(400, "body", "Request body must be a JSON object")

    locs = {}
    for fld, label in (("current_location", "Current location"),
                       ("pickup_location", "Pickup location"),
                       ("dropoff_location", "Dropoff location")):
        v = body.get(fld)
        if v is not None and not isinstance(v, str):
            return _err(400, fld, f"{label} must be text")
        v = (v or "").strip()
        if not v:
            return _err(400, fld, f"{label} is required")
        if len(v) > LOCATION_MAX:
            return _err(400, fld,
                        f"{label} is too long (max {LOCATION_MAX} characters)")
        locs[fld] = v
    current_s = locs["current_location"]
    pickup_s = locs["pickup_location"]
    dropoff_s = locs["dropoff_location"]

    try:
        cycle_used = float(body.get("current_cycle_used_hours", 0))
    except (TypeError, ValueError):
        return _err(400, "current_cycle_used_hours", "Cycle hours must be a number")
    if not (0 <= cycle_used <= 70):
        return _err(400, "current_cycle_used_hours",
                    "Cycle hours must be between 0 and 70")

    start_s = body.get("start_time")
    start_minute = 360
    if start_s not in (None, ""):
        m = (START_TIME_RE.fullmatch(start_s.strip())
             if isinstance(start_s, str) else None)
        if not m:
            return _err(400, "start_time",
                        "Start time must be HH:MM (00:00–23:59)")
        # 15-min grid; clamp so e.g. 23:53 stays on day 0 (23:45, not 24:00)
        start_minute = min(quantize_minutes(int(m[1]) * 60 + int(m[2])),
                           DAY - STEP)
        start_s = start_s.strip()

    tz_name = body.get("timezone") or "America/Chicago"
    if not isinstance(tz_name, str) or tz_name not in available_timezones():
        return _err(400, "timezone", "Unknown time zone")

    # ---- geocode the three endpoints -------------------------------------
    current = geocode.geocode(current_s)
    if not current:
        return _err(400, "current_location",
                    "Can't find that place — try City, ST")
    pickup = geocode.geocode(pickup_s)
    if not pickup:
        return _err(400, "pickup_location",
                    "Can't find that place — try City, ST")
    dropoff = geocode.geocode(dropoff_s)
    if not dropoff:
        return _err(400, "dropoff_location",
                    "Can't find that place — try City, ST")

    pts = [(p.lat, p.lng) for p in (current, pickup, dropoff)]
    if _mi(pts[1], pts[2]) < 0.5:
        return _err(400, "dropoff_location",
                    "Pickup and dropoff are the same place")
    # Driver already at the pickup: no deadhead leg to drive.
    at_pickup = _mi(pts[0], pts[1]) < 0.5

    # ---- route -------------------------------------------------------------
    try:
        route = routing.fetch_route(pts)
    except routing.RoutingError as e:
        return _err(502, "route", f"Route service is down — {e}")

    cum = routing.cumulative_distances(route.geometry)
    total_poly_miles = cum[-1]

    leg_miles = [leg.miles for leg in route.legs]
    leg_minutes = [leg.minutes for leg in route.legs]
    skipped_miles = 0.0
    if at_pickup:
        # Exactly 0 (quantize_minutes would round a stub leg up to 0:15).
        skipped_miles, leg_miles[0], leg_minutes[0] = leg_miles[0], 0.0, 0

    # Scale route_mile (driving miles per planner) to polyline miles: the
    # planner's route_mile tracks OSRM leg miles (minus any skipped
    # current->pickup stub), so map by fraction of the total OSRM distance.
    def mile_to_lnglat(route_mile):
        frac = (0.0 if route.total_miles <= 0
                else (route_mile + skipped_miles) / route.total_miles)
        return routing.position_at_mile(
            route.geometry, cum, frac * total_poly_miles)

    # ---- plan ---------------------------------------------------------------
    plan = plan_trip(
        leg_miles=leg_miles,
        leg_minutes=leg_minutes,
        cycle_used_hours=cycle_used,
        start_minute=start_minute,
    )

    # ---- enrich stops: position + city/state --------------------------------
    endpoints = [current, pickup, dropoff]
    endpoint_miles = [0.0, leg_miles[0], sum(leg_miles)]
    own_endpoint = {"pickup": pickup, "dropoff": dropoff}

    def nearest_endpoint_city(route_mile):
        i = min(range(3), key=lambda j: abs(endpoint_miles[j] - route_mile))
        return endpoints[i]

    stops_out = [{
        "id": -1, "type": "start", "status": "OFF",
        "start_min": 0, "end_min": start_minute,
        "route_mile": 0.0, "lat": current.lat, "lng": current.lng,
        "city": current.city, "state": current.state,
        "label": "Current location",
    }]
    for s in plan.stops:
        lnglat = mile_to_lnglat(s.route_mile)
        # endpoints get their geocoded city for free; mid-route stops reverse
        place = own_endpoint.get(s.type)
        if place is None:
            if min(abs(s.route_mile - em) for em in endpoint_miles) < 3.0:
                place = nearest_endpoint_city(s.route_mile)
            else:
                place = geocode.reverse(lnglat[1], lnglat[0])
        if place is None:
            place = nearest_endpoint_city(s.route_mile)
        s.city, s.state = place.city, place.state
        stops_out.append({
            "id": s.id, "type": s.type, "status": s.status,
            "start_min": s.start, "end_min": s.end,
            "route_mile": round(s.route_mile, 1),
            "lat": round(lnglat[1], 5), "lng": round(lnglat[0], 5),
            "city": s.city, "state": s.state, "label": s.label,
        })

    # ---- day logs ------------------------------------------------------------
    tz = ZoneInfo(tz_name)
    start_date = datetime.now(tz).date()
    logs = build_day_logs(plan, start_date, ceil_quarter(cycle_used * 60.0))

    # ISO-ish local timestamps for stop labels
    day0 = datetime.combine(start_date, datetime.min.time(), tzinfo=tz)

    def iso(mins):
        return (day0 + timedelta(minutes=mins)).isoformat()

    for s in stops_out:
        s["start_iso"] = iso(s["start_min"])
        s["end_iso"] = iso(s["end_min"])
        s["duration_min"] = s["end_min"] - s["start_min"]

    window_elapsed = plan.window_elapsed_at_end
    result = {
        "id": None,  # filled after save
        "input": {
            "current_location": current_s, "pickup_location": pickup_s,
            "dropoff_location": dropoff_s,
            "current_cycle_used_hours": cycle_used,
            "start_time": start_s or "06:00",
            "timezone": tz_name,
        },
        "meta": {
            "carrier": _meta(body, "carrier") or "Demo Carrier",
            "shipper": _meta(body, "shipper") or "N/A",
            "commodity": _meta(body, "commodity") or "N/A",
            "manifest": _meta(body, "manifest") or "N/A",
            "tractor": _meta(body, "tractor") or "N/A",
            "trailer": _meta(body, "trailer") or "N/A",
            "driver": _meta(body, "driver") or "N/A",
            "co_driver": _meta(body, "co_driver") or "N/A",
            "home_terminal": _meta(body, "home_terminal") or current.display,
            "main_office": _meta(body, "main_office") or "N/A",
            "timezone": tz_name,
        },
        "summary": {
            "total_miles": int(round(route.total_miles - skipped_miles)),
            "total_driving_minutes": plan.total_driving_minutes,
            "days": plan.days,
            "stops": len(stops_out),
            "fuel_stops": sum(1 for s in plan.stops if s.type == "fuel"),
            "rests": sum(1 for s in plan.stops if s.type == "rest"),
            "restarts_34": plan.restarts_34,
            "cycle_remaining_hours": round(plan.cycle_remaining_minutes / 60, 2),
            "gauges": {
                "drive_used_min": plan.drive_in_window_at_end,
                "window_elapsed_min": window_elapsed,
                "cycle_used_min": 70 * 60 - plan.cycle_remaining_minutes,
                "cycle_remaining_min": plan.cycle_remaining_minutes,
            },
        },
        "route": {
            "geometry": route.geometry,
            "legs": [
                {"miles": round(l.miles, 1), "minutes": round(l.minutes, 1),
                 "coord_start": l.coord_start, "coord_end": l.coord_end}
                for l in route.legs
            ],
            "points": {
                "current": [current.lng, current.lat],
                "pickup": [pickup.lng, pickup.lat],
                "dropoff": [dropoff.lng, dropoff.lat],
            },
        },
        "stops": stops_out,
        "logs": logs,
        "assumptions": [
            "Property-carrying CMV · 70h/8d cycle",
            "Prior cycle hours are not aged off day-by-day (daily history not provided)",
            "Pickup/dropoff 1:00 on duty · fuel 0:30 / 1000 mi · pre/post-trip 0:15",
        ],
    }

    trip = Trip.objects.create(input=result["input"], result=result)
    result["id"] = str(trip.id)
    trip.result = result
    trip.save(update_fields=["result"])
    return JsonResponse(result)


def _meta(body, key):
    """Optional free-text field: non-strings count as missing; trim + cap."""
    v = body.get(key)
    return v.strip()[:META_MAX] if isinstance(v, str) else ""


def _mi(a, b):
    lng1, lat1, lng2, lat2 = map(math.radians, [a[1], a[0], b[1], b[0]])
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 3958.8 * 2 * math.asin(math.sqrt(h))
