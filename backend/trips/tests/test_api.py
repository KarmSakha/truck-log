"""API integration test — geocode + route mocked, planner runs for real."""

import json
from unittest.mock import patch

from django.test import TestCase

from trips.services.geocode import Place
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
