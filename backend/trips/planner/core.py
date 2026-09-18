"""Hours-of-Service trip planner (property-carrying, 70h/8d).

Pure functions, no Django / network deps. Works in minutes since the
first calendar day's midnight, in the home-terminal time zone. Every
event duration is a multiple of 15 minutes (paper grid resolution).

Rules implemented (FMCSA Apr 2022 guide, per PRD §7):
  - 10 consecutive hours OFF/SB resets the 11h driving + 14h window clocks
  - 14h driving window from first ON/D after a 10h restart (no D after)
  - 11h max driving inside the window
  - 30min break after 8 cumulative driving hours (any non-D status >= 30min)
  - 70h on-duty (D+ON) in rolling 8 days; when the remaining cycle can't
    cover the next on-duty block, a 34h OFF/SB restart resets it
  - Fuel: 30min ON at least once every 1,000 driving miles
  - Pickup/dropoff: 1:00 ON each; pre/post-trip: 0:15 ON each
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

STEP = 15                      # grid resolution, minutes
DAY = 24 * 60

STATUS_OFF = "OFF"
STATUS_SB = "SB"
STATUS_D = "D"
STATUS_ON = "ON"
ON_DUTY = {STATUS_D, STATUS_ON}

LIMIT_DRIVE = 11 * 60          # 11h driving per window
LIMIT_WINDOW = 14 * 60         # 14h window
LIMIT_BREAK = 8 * 60           # 8h driving before 30min break
LIMIT_CYCLE = 70 * 60          # 70h / 8 days
FUEL_MILES = 1000.0
REST_MIN = 10 * 60
RESTART_MIN = 34 * 60
BREAK_MIN = 30
FUEL_MIN = 30
PICKUP_MIN = 60
DROPOFF_MIN = 60
PRE_TRIP_MIN = 15
POST_TRIP_MIN = 15
WRAP_OFF_MIN = 30              # OFF wrap-up before entering sleeper


@dataclass
class Event:
    start: int                 # minutes since day-0 midnight
    end: int
    status: str
    kind: str
    stop_id: Optional[int] = None
    miles: float = 0.0
    remark: Optional[str] = None   # activity text for the remarks band
    bracket: bool = False
    rest_group: Optional[int] = None  # OFF+SB pieces of one rest share a group

    @property
    def duration(self) -> int:
        return self.end - self.start


@dataclass
class Stop:
    id: int
    type: str                  # start|pre_trip|pickup|fuel|break|rest|restart_34|dropoff|post_trip
    status: str
    start: int
    end: int
    route_mile: float          # cumulative driving miles at the stop
    city: Optional[str] = None
    state: Optional[str] = None
    label: str = ""

    @property
    def duration(self) -> int:
        return self.end - self.start


@dataclass
class PlanResult:
    events: list = field(default_factory=list)
    stops: list = field(default_factory=list)
    days: int = 0
    total_driving_miles: float = 0.0
    total_driving_minutes: int = 0
    drive_in_window_at_end: int = 0
    window_elapsed_at_end: Optional[int] = None
    cycle_remaining_minutes: int = 0
    restarts_34: int = 0


def quantize_minutes(x: float) -> int:
    """Round to the nearest 15 minutes; never round a positive value to 0."""
    q = int(round(x / STEP)) * STEP
    return q if q > 0 else (STEP if x > 0 else 0)


class _Planner:
    def __init__(self, leg_miles, leg_minutes, cycle_used_minutes, start_minute):
        self.leg_miles = leg_miles
        self.leg_minutes = leg_minutes
        self.t = start_minute
        self.remaining_cycle = max(0, LIMIT_CYCLE - cycle_used_minutes)
        self.window_start: Optional[int] = None
        self.drive_in_window = 0
        self.drive_since_break = 0
        self.miles_since_fuel = 0.0
        self.route_miles_done = 0.0
        self.events: list[Event] = []
        self.stops: list[Stop] = []
        self._rest_group = 0
        self.restarts_34 = 0

    # -- timeline primitives -------------------------------------------------

    def _add_stop(self, type_, status, start, end, route_mile, label):
        self.stops.append(Stop(
            id=len(self.stops), type=type_, status=status,
            start=start, end=end, route_mile=route_mile, label=label,
        ))
        return self.stops[-1]

    def _touch_window(self, status):
        if status in ON_DUTY and self.window_start is None:
            self.window_start = self.t

    def _emit(self, status, duration, kind, *, remark=None, bracket=False,
              stop_type=None, label="", rest_group=None, miles=0.0):
        """Append an event (and optionally a stop) starting at now."""
        self._touch_window(status)
        stop_id = None
        if stop_type:
            stop = self._add_stop(stop_type, status, self.t, self.t + duration,
                                  self.route_miles_done, label)
            stop_id = stop.id
        self.events.append(Event(
            start=self.t, end=self.t + duration, status=status, kind=kind,
            stop_id=stop_id, miles=miles, remark=remark, bracket=bracket,
            rest_group=rest_group,
        ))
        self.t += duration
        if status in ON_DUTY:
            self.remaining_cycle -= duration
            if status == STATUS_D:
                self.drive_in_window += duration
                self.drive_since_break += duration
                self.miles_since_fuel += miles
                self.route_miles_done += miles

    def _ensure_cycle(self, needed_minutes):
        """If the remaining 70h cycle can't cover `needed`, take a 34h restart."""
        if self.remaining_cycle < needed_minutes:
            self._restart_34()

    def _non_driving_reset(self):
        """A >=30min non-driving period resets the 8h break clock."""
        self.drive_since_break = 0

    def _rest_10(self):
        self._rest_group += 1
        g = self._rest_group
        stop = self._add_stop("rest", STATUS_OFF, self.t, self.t + REST_MIN,
                              self.route_miles_done, "10-hr rest")
        self._emit(STATUS_OFF, WRAP_OFF_MIN, "rest_off", remark="10-hr rest",
                   bracket=True, rest_group=g)
        self._emit(STATUS_SB, REST_MIN - WRAP_OFF_MIN, "rest_sb",
                   rest_group=g)
        self.events[-2].stop_id = stop.id
        self.events[-1].stop_id = stop.id
        self.window_start = None
        self.drive_in_window = 0
        self.drive_since_break = 0

    def _restart_34(self):
        self._rest_group += 1
        g = self._rest_group
        stop = self._add_stop("restart_34", STATUS_OFF, self.t,
                              self.t + RESTART_MIN, self.route_miles_done,
                              "34-hr restart")
        self._emit(STATUS_OFF, WRAP_OFF_MIN, "restart_off",
                   remark="34-hr restart", bracket=True, rest_group=g)
        self._emit(STATUS_SB, RESTART_MIN - WRAP_OFF_MIN, "restart_sb",
                   rest_group=g)
        self.events[-2].stop_id = stop.id
        self.events[-1].stop_id = stop.id
        self.window_start = None
        self.drive_in_window = 0
        self.drive_since_break = 0
        self.remaining_cycle = LIMIT_CYCLE
        self.restarts_34 += 1

    def _fuel(self):
        self._emit(STATUS_ON, FUEL_MIN, "fuel", remark="Fuel", bracket=True,
                   stop_type="fuel", label="Fuel")
        self.miles_since_fuel = 0.0
        self._non_driving_reset()

    def _break30(self):
        self._emit(STATUS_OFF, BREAK_MIN, "break", remark="30-min break",
                   bracket=True, stop_type="break", label="30-min break")
        self._non_driving_reset()

    # -- driving -------------------------------------------------------------

    def _drive_leg(self, leg_index):
        """Walk one route leg in 15-minute slices, inserting HOS stops."""
        minutes_left = self.leg_minutes[leg_index]
        speed = self.leg_miles[leg_index] / max(1, self.leg_minutes[leg_index])

        while minutes_left > 0:
            window_end = (self.window_start + LIMIT_WINDOW
                          if self.window_start is not None else None)

            # Hard drive-time limits -> 10h restart
            if (self.drive_in_window >= LIMIT_DRIVE
                    or (window_end is not None and self.t + STEP > window_end)):
                self._rest_10()
                continue

            # Cycle exhausted -> 34h restart
            if self.remaining_cycle < STEP:
                self._restart_34()
                continue

            slice_miles = STEP * speed

            # Fuel before exceeding 1,000 miles since last fuel
            if self.miles_since_fuel + slice_miles > FUEL_MILES:
                self._ensure_cycle(FUEL_MIN)
                self._fuel()
                continue

            # 8h driving -> 30min break
            if self.drive_since_break + STEP > LIMIT_BREAK:
                self._break30()
                continue

            self._emit(STATUS_D, STEP, "drive", miles=slice_miles)
            minutes_left -= STEP

    # -- public driver --------------------------------------------------------

    def run(self):
        day_end = ((self.t // DAY) + 1) * DAY

        # Off duty until the first work of the day.
        if self.t > 0:
            self.events.append(Event(
                start=0, end=self.t, status=STATUS_OFF, kind="off_duty_start"))

        # Pre-trip (needs cycle; a 34h restart may come first).
        self._ensure_cycle(PRE_TRIP_MIN)
        self._emit(STATUS_ON, PRE_TRIP_MIN, "pre_trip",
                   remark="Pre-trip / TIV", bracket=True,
                   stop_type="pre_trip", label="Pre-trip / TIV")

        self._drive_leg(0)

        self._ensure_cycle(PICKUP_MIN)
        self._emit(STATUS_ON, PICKUP_MIN, "pickup", remark="Pickup / loading",
                   bracket=True, stop_type="pickup", label="Pickup / loading")

        if len(self.leg_miles) > 1:
            self._drive_leg(1)

        self._ensure_cycle(DROPOFF_MIN)
        self._emit(STATUS_ON, DROPOFF_MIN, "dropoff",
                   remark="Dropoff / unloading", bracket=True,
                   stop_type="dropoff", label="Dropoff / unloading")

        self._ensure_cycle(POST_TRIP_MIN)
        self._emit(STATUS_ON, POST_TRIP_MIN, "post_trip",
                   remark="Post-trip / TIV", bracket=True,
                   stop_type="post_trip", label="Post-trip / TIV")

        work_end = self.t  # gauges reflect state when the shift ends

        # Off duty, then sleeper, for the rest of the final calendar day.
        last_day_end = ((self.t - 1) // DAY + 1) * DAY
        if last_day_end > self.t:
            off_wrap = min(WRAP_OFF_MIN, last_day_end - self.t)
            self._emit(STATUS_OFF, off_wrap, "off_duty_end",
                       remark="Off duty", bracket=True)
            if last_day_end > self.t:
                self._emit(STATUS_SB, last_day_end - self.t, "sleeper_end")

        # Sort + annotate.
        self.events.sort(key=lambda e: e.start)
        res = PlanResult(
            events=self.events,
            stops=self.stops,
            days=(self.events[-1].end - 1) // DAY + 1,
            total_driving_miles=self.route_miles_done,
            total_driving_minutes=sum(e.duration for e in self.events
                                      if e.status == STATUS_D),
            drive_in_window_at_end=self.drive_in_window,
            window_elapsed_at_end=(work_end - self.window_start
                                   if self.window_start is not None else None),
            cycle_remaining_minutes=self.remaining_cycle,
            restarts_34=self.restarts_34,
        )
        return res


def plan_trip(leg_miles, leg_minutes, cycle_used_hours, start_minute=360):
    """Plan the trip timeline.

    leg_miles/leg_minutes: parallel lists, leg0 = current->pickup,
      leg1 = pickup->dropoff. Minutes must already be 15-minute quantized.
    cycle_used_hours: 0..70 on-duty hours already used this 8-day cycle.
    start_minute: minutes after midnight, home-terminal time (default 06:00).
    """
    assert len(leg_miles) == len(leg_minutes) >= 1
    leg_minutes = [quantize_minutes(m) for m in leg_minutes]
    cycle_used_minutes = quantize_minutes(float(cycle_used_hours) * 60.0)
    p = _Planner(leg_miles, leg_minutes, cycle_used_minutes, start_minute)
    return p.run()
