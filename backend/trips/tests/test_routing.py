from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from trips.services.routing import fetch_route


class RouteDirectionsTests(SimpleTestCase):
    @patch("trips.services.routing.requests.get")
    def test_requests_steps_and_preserves_order_distance_and_maneuvers(self, get):
        get.return_value = Mock(json=lambda: {
            "code": "Ok", "waypoints": [{"location": [0, 0]}, {"location": [1, 1]}],
            "routes": [{"geometry": {"coordinates": [[0, 0], [1, 1]]},
                "distance": 1609.344, "duration": 120,
                "legs": [{"distance": 1609.344, "duration": 120, "steps": [
                    {"name": "Main Street", "distance": 1609.344,
                     "maneuver": {"type": "turn", "modifier": "uturn"}},
                    {"distance": 0, "maneuver": {"type": "arrive"}}
                ]}]}]})
        result = fetch_route([(0, 0), (1, 1)])
        self.assertIn("steps=true", get.call_args.args[0])
        self.assertEqual(result.legs[0].directions, [
            {"instruction": "Make a U-turn onto Main Street", "miles": 1.0},
            {"instruction": "Arrive at your destination", "miles": 0.0}])
