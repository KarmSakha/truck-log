"""HOS planner unit tests — the accuracy bar reviewers will test."""

from datetime import date

from django.test import SimpleTestCase

from trips.planner.core import (
    DAY, STATUS_D, STATUS_OFF, STATUS_ON, STATUS_SB, ceil_quarter, plan_trip,
)
from trips.planner.days import build_day_logs

MPH = 55.0


def legs(*mile_min):
    """Build leg_miles/leg_minutes from (miles, minutes) pairs."""
    return [m for m, _ in mile_min], [m for _, m in mile_min]


def statuses(plan):
    return [(e.status, e.start, e.end, e.kind) for e in plan.events]


def drive_runs(plan):
    """Contiguous driving windows -> list of (window_drive_min, window_span)."""
    # Re-derive windows: a rest (rest_off/restart_off) closes a window.
    windows, cur_drive, cur_span, cur_start = [], 0, 0, None
    for e in plan.events:
        if e.status == STATUS_D:
            if cur_start is None:
                cur_start = e.start
            cur_drive += e.duration
            cur_span = e.end - cur_start
        elif e.status in (STATUS_ON,) or e.kind == "break":
            if cur_start is not None:
                cur_span = e.end - cur_start  # ON inside window extends span
        else:  # OFF/SB >= 10h rest events
            if e.kind in ("rest_off", "restart_off"):
                if cur_start is not None:
                    windows.append((cur_drive, cur_span))
                cur_drive, cur_span, cur_start = 0, 0, None
    if cur_start is not None:
        windows.append((cur_drive, cur_span))
    return windows


def check_no_violations(test, plan):
    """Shared invariants: totals, no driving past limits."""
    # events tile [0, end] with no gaps/overlaps
    evs = sorted(plan.events, key=lambda e: e.start)
    for a, b in zip(evs, evs[1:]):
        test.assertEqual(a.end, b.start, f"gap/overlap at {a.end}")
    # all durations on the 15-min grid
    for e in evs:
        test.assertEqual(e.start % 15, 0)
        test.assertEqual(e.end % 15, 0)
    # driving limits inside each window
    for drive_min, span in drive_runs(plan):
        test.assertLessEqual(drive_min, 11 * 60, "11h exceeded")
        test.assertLessEqual(span, 14 * 60 + 60 + 30,
                             "window too long")  # window incl. stops
    # no more than 8h driving without 30 consecutive non-driving minutes
    since_break, idle = 0, 0
    for e in evs:
        if e.status == STATUS_D:
            since_break, idle = since_break + e.duration, 0
            test.assertLessEqual(since_break, 8 * 60, "30-min break missed")
        else:
            idle += e.duration
            if idle >= 30:
                since_break = 0


def check_logs(test, logs):
    for log in logs:
        t = log["totals"]
        total = t["off_min"] + t["sb_min"] + t["driving_min"] + t["on_min"]
        test.assertEqual(total, DAY, f"day {log['date']} != 24h")
        segs = log["segments"]
        test.assertEqual(segs[0]["start_min"], 0)
        test.assertEqual(segs[-1]["end_min"], DAY)
        for a, b in zip(segs, segs[1:]):
            test.assertEqual(a["end_min"], b["start_min"])
            test.assertNotEqual(a["status"], b["status"],
                                "adjacent same-status segments should merge")


class PlannerBasicsTests(SimpleTestCase):
    def test_short_hop_single_day(self):
        lm, lt = legs((30, 35), (45, 50))
        plan = plan_trip(lm, lt, cycle_used_hours=10)
        check_no_violations(self, plan)
        kinds = [e.kind for e in plan.events]
        deduped = [k for i, k in enumerate(kinds)
                   if i == 0 or k != kinds[i - 1]]
        self.assertEqual(deduped, [
            "off_duty_start", "pre_trip", "drive", "pickup", "drive",
            "dropoff", "post_trip", "off_duty_end", "sleeper_end",
        ])
        self.assertEqual(plan.days, 1)
        logs = build_day_logs(plan, date(2026, 9, 19), 600)
        check_logs(self, logs)
        self.assertEqual(len(logs), 1)
        # driving segments are actually the D rows (35->30, 50->45 quantized)
        d_min = sum(s["end_min"] - s["start_min"]
                    for s in logs[0]["segments"] if s["status"] == STATUS_D)
        self.assertEqual(d_min, 75)

    def test_zero_length_first_leg(self):
        # Driver already at the pickup: leg 0 is exactly 0 mi / 0 min.
        lm, lt = legs((0.0, 0), (300, 330))
        plan = plan_trip(lm, lt, 0)
        check_no_violations(self, plan)
        kinds = [e.kind for e in plan.events]
        deduped = [k for i, k in enumerate(kinds)
                   if i == 0 or k != kinds[i - 1]]
        self.assertEqual(deduped, [
            "off_duty_start", "pre_trip", "pickup", "drive",
            "dropoff", "post_trip", "off_duty_end", "sleeper_end",
        ])
        pickup = next(s for s in plan.stops if s.type == "pickup")
        self.assertEqual(pickup.start, 360 + 15)  # right after pre-trip
        self.assertEqual(pickup.route_mile, 0.0)
        self.assertAlmostEqual(plan.total_driving_miles, 300, places=6)
        self.assertEqual(plan.total_driving_minutes, 330)
        check_logs(self, build_day_logs(plan, date(2026, 9, 19), 0))

    def test_pickup_dropoff_one_hour_on(self):
        lm, lt = legs((60, 65), (60, 65))
        plan = plan_trip(lm, lt, 0)
        on = {e.kind: e.duration for e in plan.events
              if e.status == STATUS_ON}
        self.assertEqual(on["pickup"], 60)
        self.assertEqual(on["dropoff"], 60)
        self.assertEqual(on["pre_trip"], 15)
        self.assertEqual(on["post_trip"], 15)


class BreakAndWindowTests(SimpleTestCase):
    def test_30min_break_after_8h_driving(self):
        # ~9h drive in leg2 -> needs one break
        lm, lt = legs((10, 15), (9 * 60, 9 * 60))
        plan = plan_trip(lm, lt, 0)
        breaks = [e for e in plan.events if e.kind == "break"]
        self.assertGreaterEqual(len(breaks), 1)
        self.assertEqual(breaks[0].status, STATUS_OFF)
        self.assertEqual(breaks[0].duration, 30)
        check_no_violations(self, plan)
        logs = build_day_logs(plan, date(2026, 9, 19), 0)
        check_logs(self, logs)
        # remark exists for the break
        acts = [r["activity"] for l in logs for r in l["remarks"]]
        self.assertIn("30-min break", acts)

    def test_pickup_hour_resets_break_clock(self):
        # 4h drive, 1h pickup (>= 30 min non-driving), 5h drive: no break.
        lm, lt = legs((4 * MPH, 4 * 60), (5 * MPH, 5 * 60))
        plan = plan_trip(lm, lt, 0)
        self.assertEqual([e for e in plan.events if e.kind == "break"], [])
        check_no_violations(self, plan)

    def test_single_long_leg_gets_exactly_one_break(self):
        lm, lt = legs((8.5 * MPH, 8 * 60 + 30))
        plan = plan_trip(lm, lt, 0)
        breaks = [e for e in plan.events if e.kind == "break"]
        self.assertEqual(len(breaks), 1)
        self.assertEqual(breaks[0].duration, 30)
        check_no_violations(self, plan)

    def test_11h_drive_forces_10h_rest(self):
        # 13h of driving needs a rest; none allowed past 11h in a window
        lm, lt = legs((5, 10), (13 * 60, 13 * 60))
        plan = plan_trip(lm, lt, 0)
        rests = [e for e in plan.events if e.kind == "rest_off"]
        self.assertGreaterEqual(len(rests), 1)
        for d, span in drive_runs(plan):
            self.assertLessEqual(d, 660)
        check_no_violations(self, plan)

    def test_14h_window_forces_rest_even_with_drive_left(self):
        # slow driving: 12h of driving spread with long stops pushes the
        # window past 14h; ensure rest is inserted before window expires.
        lm, lt = legs((5, 10), (12 * 60 + 30, 12 * 60 + 30))
        plan = plan_trip(lm, lt, 0)
        check_no_violations(self, plan)
        # find any D segment that would start after window end
        # reconstruct windows
        evs = sorted(plan.events, key=lambda e: e.start)
        window_start = None
        for e in evs:
            if e.kind in ("rest_off", "restart_off"):
                window_start = None
            if e.status in (STATUS_ON, STATUS_D) and window_start is None:
                window_start = e.start
            if e.status == STATUS_D:
                self.assertLessEqual(e.end, window_start + 14 * 60)

    def test_multi_day_trip_multiple_sheets(self):
        # ~2000 miles -> several days
        lm, lt = legs((400, 7 * 60), (1600, 28 * 60))
        plan = plan_trip(lm, lt, 0)
        self.assertGreater(plan.days, 2)
        logs = build_day_logs(plan, date(2026, 9, 19), 0)
        check_logs(self, logs)
        self.assertEqual(len(logs), plan.days)


class FuelAndCycleTests(SimpleTestCase):
    def test_fuel_every_1000_miles(self):
        lm, lt = legs((50, 60), (2300, 42 * 60))
        plan = plan_trip(lm, lt, 0)
        fuels = [e for e in plan.events if e.kind == "fuel"]
        self.assertGreaterEqual(len(fuels), 2)
        for f in fuels:
            self.assertEqual(f.status, STATUS_ON)
            self.assertEqual(f.duration, 30)
        # miles between fuel stops <= 1000
        miles_at_fuels = []
        run = 0.0
        for e in plan.events:
            if e.kind == "fuel":
                miles_at_fuels.append(run)
                run = 0.0
            elif e.status == STATUS_D:
                run += e.miles
        prev = 0.0
        for m in miles_at_fuels:
            self.assertLessEqual(m - prev, 1000.001)
            prev = m
        check_no_violations(self, plan)

    def test_34h_restart_when_cycle_low(self):
        lm, lt = legs((30, 30), (600, 11 * 60))
        plan = plan_trip(lm, lt, cycle_used_hours=66)
        restarts = [e for e in plan.events if e.kind == "restart_off"]
        self.assertGreaterEqual(len(restarts), 1)
        # after restart, 34h of OFF+SB
        off = next(e for e in plan.events if e.kind == "restart_off")
        sb = next(e for e in plan.events if e.kind == "restart_sb")
        self.assertEqual(off.duration + sb.duration, 34 * 60)
        check_no_violations(self, plan)

    def test_cycle_70_plans_anyway_with_restart_first(self):
        lm, lt = legs((30, 30), (60, 60))
        plan = plan_trip(lm, lt, cycle_used_hours=70)
        # first event after leading OFF should be the restart
        kinds = [e.kind for e in plan.events]
        self.assertEqual(kinds[0], "off_duty_start")
        self.assertEqual(kinds[1], "restart_off")
        self.assertEqual(kinds[2], "restart_sb")
        self.assertEqual(plan.restarts_34, 1)
        check_no_violations(self, plan)
        logs = build_day_logs(plan, date(2026, 9, 19), 70 * 60)
        check_logs(self, logs)

    def test_unloading_and_post_trip_do_not_require_cycle_restart(self):
        plan = plan_trip([0, 50], [0, 60], cycle_used_hours=67.5)
        self.assertEqual(plan.restarts_34, 0)
        self.assertEqual(plan.days, 1)
        self.assertEqual(next(e.start for e in plan.events if e.kind == "dropoff"), 495)
        self.assertEqual(plan.cycle_remaining_minutes, -60)
        check_no_violations(self, plan)

    def test_loading_can_exhaust_cycle_but_next_drive_requires_restart(self):
        plan = plan_trip([0, 50], [0, 60], cycle_used_hours=69.5)
        pickup = next(e for e in plan.events if e.kind == "pickup")
        restart = next(s for s in plan.stops if s.type == "restart_34")
        drive = next(e for e in plan.events if e.status == STATUS_D)
        self.assertEqual(restart.start, pickup.end)
        self.assertEqual(drive.start, restart.end)
        check_no_violations(self, plan)

    def test_ceil_quarter(self):
        self.assertEqual(ceil_quarter(0), 0)
        self.assertEqual(ceil_quarter(65.0 * 60), 3900)
        self.assertEqual(ceil_quarter(65.1 * 60), 3915)   # 65.1h -> 65.25h
        self.assertEqual(ceil_quarter(37.3 * 60), 2250)   # 37.3h -> 37.5h
        self.assertEqual(ceil_quarter(1), 15)
        self.assertEqual(ceil_quarter(70 * 60), 70 * 60)

    def test_fractional_cycle_hours_never_exceed_70(self):
        # 65.1h used: rounding to the nearest 15 min (65.0h) would let the
        # plan drive to 70.1 real hours before the 34h restart.
        lm, lt = legs((30, 30), (600, 11 * 60))
        plan = plan_trip(lm, lt, cycle_used_hours=65.1)
        restart = next(e for e in plan.events if e.kind == "restart_off")
        on_before = sum(e.duration for e in plan.events
                        if e.status in (STATUS_D, STATUS_ON)
                        and e.end <= restart.start)
        self.assertLessEqual(on_before, 70 * 60 - 65.1 * 60)
        check_no_violations(self, plan)

    def test_no_driving_after_cycle_exhaustion(self):
        lm, lt = legs((200, 4 * 60), (900, 16 * 60))
        plan = plan_trip(lm, lt, cycle_used_hours=40)
        check_no_violations(self, plan)
        # walk the timeline: on-duty between restarts <= 70h - 40h window
        win = 40 * 60
        for e in sorted(plan.events, key=lambda x: x.start):
            if e.kind == "restart_sb":
                win = 0
                continue
            if e.status in (STATUS_ON, STATUS_D):
                win += e.duration
                if e.status == STATUS_D:
                    self.assertLessEqual(win, 70 * 60 + 1)


class GoldenFixtureTest(SimpleTestCase):
    """Schneider golden day from the walkthrough video (drawing QA fixture).

    Timeline per PRD §10.5 -> totals OFF 8:30 / SB 5:00 / D 9:30 / ON 1:00,
    circled 10.5, 472 miles.
    """

    def test_golden_totals(self):
        from trips.planner.core import Event, PlanResult, Stop

        stops = [
            Stop(id=0, type="pre_trip", status="ON", start=390, end=420,
                 route_mile=0, city="Green Bay", state="WI"),
            Stop(id=1, type="fuel", status="ON", start=510, end=540,
                 route_mile=90, city="Fond Du Lac", state="WI"),
            Stop(id=2, type="break", status="OFF", start=780, end=810,
                 route_mile=240, city="Paw Paw", state="IL"),
            Stop(id=3, type="rest", status="OFF", start=1050, end=1440,
                 route_mile=472, city="Edwardsville", state="IL"),
        ]
        evs = [
            Event(0, 390, STATUS_OFF, "off_duty_start"),
            Event(390, 420, STATUS_ON, "pre_trip", stop_id=0,
                  remark="Pre-trip / TIV", bracket=True),
            Event(420, 510, STATUS_D, "drive", miles=90),
            Event(510, 540, STATUS_ON, "fuel", stop_id=1,
                  remark="Scale", bracket=True),
            Event(540, 780, STATUS_D, "drive", miles=200),
            Event(780, 810, STATUS_OFF, "break", stop_id=2,
                  remark="30-min break", bracket=True),
            Event(810, 1050, STATUS_D, "drive", miles=182),
            Event(1050, 1140, STATUS_OFF, "rest_off", stop_id=3,
                  remark="10-hr rest", bracket=True, rest_group=1),
            Event(1140, 1440, STATUS_SB, "rest_sb", stop_id=3, rest_group=1),
        ]
        plan = PlanResult(events=evs, stops=stops, days=1,
                          total_driving_miles=472)
        logs = build_day_logs(plan, date(2024, 4, 6), 0)
        (log,) = logs
        self.assertEqual(log["totals"]["off"], "8:30")
        self.assertEqual(log["totals"]["sb"], "5:00")
        self.assertEqual(log["totals"]["driving"], "9:30")
        self.assertEqual(log["totals"]["on"], "1:00")
        self.assertEqual(log["totals"]["sum"], "24:00")
        self.assertEqual(log["on_duty_decimal"], 10.5)
        self.assertEqual(log["miles_driving"], 472)
        self.assertEqual(len(log["remarks"]), 4)


class RecapTests(SimpleTestCase):
    """70/8 recap: A = last 7 days, B = 70 - A, C = last 8 days."""

    def test_recap_after_restart_counts_only_post_restart_hours(self):
        lm, lt = legs((30, 30), (2400, 44 * 60))
        plan = plan_trip(lm, lt, cycle_used_hours=66)
        restart_end = next(e.end for e in plan.events if e.kind == "restart_sb")
        logs = build_day_logs(plan, date(2026, 9, 19), 66 * 60)
        for d, log in enumerate(logs):
            r = log["recap"]
            self.assertGreaterEqual(r["a"], 0)
            self.assertLessEqual(r["a"], 70)
            self.assertAlmostEqual(r["b"], 70 - r["a"], places=2)
            self.assertGreaterEqual(r["c"], r["a"])
            day_end = (d + 1) * DAY
            if restart_end <= day_end:
                since = sum(
                    max(0, min(e.end, day_end) - max(e.start, restart_end))
                    for e in plan.events if e.status in (STATUS_D, STATUS_ON)
                )
                self.assertAlmostEqual(r["a"], since / 60, places=2)

    def test_recap_c_is_an_eight_day_window(self):
        from trips.planner.core import Event, PlanResult

        # 10 days, 2h on duty each morning, 10h of prior cycle hours.
        evs = []
        for d in range(10):
            base = d * DAY
            evs += [Event(base, base + 360, STATUS_OFF, "off"),
                    Event(base + 360, base + 480, STATUS_ON, "on"),
                    Event(base + 480, base + DAY, STATUS_OFF, "off")]
        plan = PlanResult(events=evs, stops=[], days=10)
        logs = build_day_logs(plan, date(2026, 9, 19), 10 * 60)
        # day 4 (index 3): both windows reach before the trip -> prior counts
        self.assertEqual(logs[3]["recap"]["a"], 10 + 4 * 2)
        self.assertEqual(logs[3]["recap"]["c"], 10 + 4 * 2)
        # day 7 (index 6): A is trip days 1-7 only, C still reaches back
        self.assertEqual(logs[6]["recap"]["a"], 7 * 2)
        self.assertEqual(logs[6]["recap"]["c"], 10 + 7 * 2)
        # day 10 (index 9): C = last 8 days, A = last 7, B = 70 - A
        self.assertEqual(logs[9]["recap"]["c"], 8 * 2)
        self.assertEqual(logs[9]["recap"]["a"], 7 * 2)
        self.assertEqual(logs[9]["recap"]["b"], 70 - 14)
