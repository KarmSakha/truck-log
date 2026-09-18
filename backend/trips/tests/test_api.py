"""API integration test — geocode + route mocked, planner runs for real."""

import json
from unittest.mock import Mock, patch

import requests
from django.conf import settings
from django.test import TestCase

from trips.services import geocode
from trips.services.geocode import PHOTON_URL, Place
from trips.services.routing import LegResult, RouteResult


def _fake_geocode(q):
    table = {
        "chicago": Place(41.8781, -87.6298, "Chicago", "IL", "Chicago, IL", {}),
        "dallas": Place(32.7767, -96.7970, "Dallas", "TX", "Dallas, TX", {}),
        "houston": Place(29.7604, -95.3698, "Houston", "TX", "Houston, TX", {}),
    }
    return table.get(q.split(",")[0].strip().lower())


def _fake_route(_pts):
    # two legs Chicago->Dallas->Houston, ~1205 mi, ~21.25 h
    return RouteResult(
        geometry=[[-87.63, 41.88], [-90.0, 38.5], [-96.80, 32.78],
                  [-96.0, 31.0], [-95.37, 29.76]],
        legs=[
            LegResult(miles=966.9, minutes=870, coord_start=0, coord_end=2),
            LegResult(miles=238.6, minutes=405, coord_start=2, coord_end=4),
        ],
        total_miles=1205.5,
        total_minutes=1275,
    )


def _fake_route_at_pickup(_pts):
    # Dallas -> Dallas (a stub leg) -> Houston
    return RouteResult(
        geometry=[[-96.80, 32.78], [-96.79, 32.78], [-96.0, 31.0],
                  [-95.37, 29.76]],
        legs=[
            LegResult(miles=0.3, minutes=1.2, coord_start=0, coord_end=1),
            LegResult(miles=238.6, minutes=405, coord_start=1, coord_end=3),
        ],
        total_miles=238.9,
        total_minutes=406.2,
    )


def _post(client, **body):
    base = {"current_location": "Chicago, IL",
            "pickup_location": "Dallas, TX",
            "dropoff_location": "Houston, TX",
            "current_cycle_used_hours": 20}
    base.update(body)
    return client.post("/api/trips/", data=json.dumps(base),
                       content_type="application/json")


# Full geocode + routing mocks: the planner runs for real, nothing hits the
# network.
_mock_services = [
    patch("trips.services.routing.position_at_mile",
          return_value=(-95.0, 30.0)),  # (lng, lat)
    patch("trips.views.routing.cumulative_distances",
          return_value=[0, 500, 966.9, 1100, 1205.5]),
    patch("trips.views.routing.fetch_route", side_effect=_fake_route),
    patch("trips.views.geocode.geocode", side_effect=_fake_geocode),
    patch("trips.views.geocode.reverse",
          return_value=Place(30.0, -95.0, "Nowhere", "TX", "Nowhere, TX", {})),
]


class TripApiTests(TestCase):
    @patch("trips.services.routing.position_at_mile",
           return_value=(-95.0, 30.0))  # (lng, lat)
    @patch("trips.views.routing.cumulative_distances",
           return_value=[0, 500, 966.9, 1100, 1205.5])
    @patch("trips.views.routing.fetch_route", side_effect=_fake_route)
    @patch("trips.views.geocode.geocode", side_effect=_fake_geocode)
    @patch("trips.views.geocode.reverse",
           return_value=Place(30.0, -95.0, "Nowhere", "TX", "Nowhere, TX", {}))
    def test_create_trip_happy_path(self, *_mocks):
        r = self.client.post(
            "/api/trips/",
            data=json.dumps({
                "current_location": "Chicago, IL",
                "pickup_location": "Dallas, TX",
                "dropoff_location": "Houston, TX",
                "current_cycle_used_hours": 20,
            }),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content[:400])
        d = r.json()
        self.assertIn("id", d)
        self.assertEqual(d["summary"]["days"], len(d["logs"]))
        self.assertGreater(d["summary"]["total_miles"], 1000)
        for log in d["logs"]:
            t = log["totals"]
            self.assertEqual(
                t["off_min"] + t["sb_min"] + t["driving_min"] + t["on_min"],
                1440, f"{log['date']} not 24h")
        types = {s["type"] for s in d["stops"]}
        self.assertIn("pickup", types)
        self.assertIn("dropoff", types)
        self.assertIn("break", types)

        # shareable URL round-trips
        r2 = self.client.get(f"/api/trips/{d['id']}/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["id"], d["id"])

    @patch("trips.views.geocode.geocode", return_value=None)
    def test_bad_location_400(self, _m):
        r = self.client.post(
            "/api/trips/",
            data=json.dumps({
                "current_location": "ZZZ nowhere",
                "pickup_location": "Dallas, TX",
                "dropoff_location": "Houston, TX",
                "current_cycle_used_hours": 0,
            }),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["field"], "current_location")

    @patch("trips.services.routing.position_at_mile",
           return_value=(-96.8, 32.78))
    @patch("trips.views.routing.cumulative_distances",
           return_value=[0, 0.3, 120, 238.9])
    @patch("trips.views.routing.fetch_route",
           side_effect=_fake_route_at_pickup)
    @patch("trips.views.geocode.geocode", side_effect=_fake_geocode)
    @patch("trips.views.geocode.reverse",
           return_value=Place(31.0, -96.0, "Nowhere", "TX", "Nowhere, TX", {}))
    def test_driver_already_at_pickup(self, *_mocks):
        r = _post(self.client, current_location="Dallas, TX",
                  pickup_location="Dallas, TX", start_time="06:00")
        self.assertEqual(r.status_code, 200, r.content[:400])
        d = r.json()
        stops = d["stops"]
        self.assertEqual([s["type"] for s in stops[:3]],
                         ["start", "pre_trip", "pickup"])
        pickup = stops[2]
        # no deadhead driving: pickup follows the 15-min pre-trip directly
        self.assertEqual(pickup["start_min"], 6 * 60 + 15)
        self.assertEqual(pickup["route_mile"], 0.0)
        self.assertEqual((pickup["city"], pickup["state"]), ("Dallas", "TX"))
        dropoff = next(s for s in stops if s["type"] == "dropoff")
        self.assertEqual((dropoff["city"], dropoff["state"]),
                         ("Houston", "TX"))
        self.assertEqual(d["summary"]["total_driving_minutes"], 405)
        self.assertEqual(d["summary"]["total_miles"], 239)

    @patch("trips.views.routing.fetch_route")
    @patch("trips.views.geocode.geocode", side_effect=_fake_geocode)
    def test_pickup_equals_dropoff_400(self, _geo, route):
        r = _post(self.client, dropoff_location="Dallas, TX")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["field"], "dropoff_location")
        self.assertEqual(r.json()["error"],
                         "Pickup and dropoff are the same place")
        route.assert_not_called()


@patch("trips.views.routing.fetch_route", side_effect=AssertionError)
@patch("trips.views.geocode.geocode", return_value=None)
class TripInputValidationTests(TestCase):
    """Malformed input is a 400 on the right field, never a 500."""

    def test_body_not_an_object(self, *_m):
        r = self.client.post("/api/trips/", data=json.dumps(["Chicago"]),
                             content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["field"], "body")
        self.assertEqual(r.json()["error"],
                         "Request body must be a JSON object")

    def test_location_not_a_string(self, *_m):
        r = _post(self.client, current_location=12345)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["field"], "current_location")

    def test_location_too_long(self, *_m):
        r = _post(self.client, pickup_location="x" * 201)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["field"], "pickup_location")

    def test_timezone_not_a_string(self, *_m):
        r = _post(self.client, timezone=["America/Chicago"])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["field"], "timezone")

    def test_start_time_out_of_range(self, *_m):
        for bad in ("25:99", "24:00", "7", "07:60", "ab:cd", 700):
            r = _post(self.client, start_time=bad)
            self.assertEqual(r.status_code, 400, bad)
            self.assertEqual(r.json()["field"], "start_time", bad)
            self.assertEqual(r.json()["error"],
                             "Start time must be HH:MM (00:00\u201323:59)")


class TripStartTimeTests(TestCase):
    def setUp(self):
        for p in _mock_services:
            p.start()
            self.addCleanup(p.stop)

    def test_late_start_clamps_to_2345(self):
        r = _post(self.client, start_time="23:53")
        self.assertEqual(r.status_code, 200, r.content[:400])
        d = r.json()
        pre = next(s for s in d["stops"] if s["type"] == "pre_trip")
        self.assertLessEqual(pre["start_min"], 23 * 60 + 45)
        self.assertEqual(d["stops"][0]["end_min"], pre["start_min"])
        self.assertEqual(d["logs"][0]["segments"][-1]["end_min"], 1440)

    def test_non_string_meta_fields_are_ignored(self):
        r = _post(self.client, carrier={"x": 1}, driver=42,
                  shipper="  Acme  ", commodity="y" * 300)
        self.assertEqual(r.status_code, 200, r.content[:400])
        meta = r.json()["meta"]
        self.assertEqual(meta["carrier"], "Demo Carrier")
        self.assertEqual(meta["driver"], "N/A")
        self.assertEqual(meta["shipper"], "Acme")
        self.assertEqual(meta["commodity"], "y" * 80)


def _photon_response(features):
    resp = Mock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = {"features": features}
    return resp


def _photon_feature(name, state, country, lng, lat):
    return {"geometry": {"coordinates": [lng, lat]},
            "properties": {"name": name, "state": state,
                           "country": country,
                           "countrycode": "US" if country == "United States"
                           else "FR"}}


@patch("trips.services.geocode._throttle")
class GeocodeSearchTests(TestCase):
    """Typeahead: Photon only (Nominatim forbids autocomplete), cached."""

    @patch("trips.services.geocode.requests.get")
    def test_autocomplete_never_calls_nominatim(self, get, _thr):
        get.return_value = _photon_response([
            _photon_feature("Dallas", "Texas", "United States", -96.8, 32.78),
            _photon_feature("Dallas", "Grand Est", "France", 6.1, 48.7),
        ])
        out = geocode.autocomplete("Dallas")
        self.assertEqual(out, [{"lat": 32.78, "lng": -96.8,
                                "label": "Dallas, Texas, United States",
                                "city": "Dallas", "state": "TX"}])
        # repeat keystrokes are served from the cache
        self.assertEqual(geocode.autocomplete("  dallas "), out)
        self.assertEqual(get.call_count, 1)
        # and a provider outage still never falls back to Nominatim
        get.side_effect = requests.ConnectionError
        with self.assertRaises(requests.RequestException):
            geocode.autocomplete("Houston")
        urls = [c.args[0] for c in get.call_args_list]
        self.assertTrue(all(u.startswith(PHOTON_URL) for u in urls), urls)
        self.assertFalse(any(settings.NOMINATIM_URL in u for u in urls), urls)

    @patch("trips.services.geocode.requests.get",
           side_effect=requests.ConnectionError)
    def test_provider_failure_is_502(self, _get, _thr):
        r = self.client.get("/api/geocode/", {"q": "Dallas"})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json(), {"results": [],
                                    "error": "Place search is unavailable"})

    @patch("trips.services.geocode.requests.get",
           return_value=_photon_response([]))
    def test_no_matches_is_200_empty(self, _get, _thr):
        r = self.client.get("/api/geocode/", {"q": "Zzyzxqq"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"results": []})


class ThrottleTests(TestCase):
    def test_calls_to_one_host_are_spaced(self):
        import os
        import tempfile
        import time
        name = f"test-{time.time_ns()}"
        for n in (name, name + "-other"):
            self.addCleanup(lambda n=n: os.remove(os.path.join(
                tempfile.gettempdir(), f"hosdesk-geo-{n}.lock")))
        geocode._throttle(name, 0.2)
        t0 = time.monotonic()
        geocode._throttle(name, 0.2)
        self.assertGreaterEqual(time.monotonic() - t0, 0.15)
        # a different host has its own lock file / clock
        t1 = time.monotonic()
        geocode._throttle(name + "-other", 0.2)
        self.assertLess(time.monotonic() - t1, 0.1)
