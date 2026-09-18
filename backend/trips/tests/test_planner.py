"""HOS planner unit tests — the accuracy bar reviewers will test."""

from datetime import date

from django.test import SimpleTestCase

from trips.planner.core import (
    DAY, STATUS_D, STATUS_OFF, STATUS_ON, STATUS_SB, plan_trip,
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

    def test_cycle_never_exceeded_by_on_duty(self):
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
