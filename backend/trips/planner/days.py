"""Split a plan timeline into per-calendar-day log sheets.

Each sheet covers one midnight->midnight window in home-terminal time.
Segments are clipped at day boundaries; the four status totals on every
sheet sum to exactly 24:00. Remarks attach to the duty-status change that
begins a labeled (non-driving) segment; the OFF->SB transition inside a
single rest block shares the rest's remark and gets none of its own.
"""

from __future__ import annotations

from .core import DAY, ON_DUTY, STATUS_D, STATUS_OFF, STATUS_SB, STATUS_ON


def _fmt_hm(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def build_day_logs(plan, start_date, cycle_used_minutes):
    """Return a list of per-day log dicts ready for JSON serialization."""
    from datetime import timedelta

    days = []
    n_days = plan.days

    # Restart completion times (for the recap windows).
    restart_ends = [e.end for e in plan.events if e.kind == "restart_sb"]

    stops_by_id = {s.id: s for s in plan.stops}

    for d in range(n_days):
        day_start, day_end = d * DAY, (d + 1) * DAY
        date = start_date + timedelta(days=d)

        segments = []
        totals = {STATUS_OFF: 0, STATUS_SB: 0, STATUS_D: 0, STATUS_ON: 0}
        miles = 0.0
        remarks = []

        for ev in plan.events:
            ov_s, ov_e = max(ev.start, day_start), min(ev.end, day_end)
            if ov_e <= ov_s:
                continue
            frac = (ov_e - ov_s) / ev.duration
            seg_miles = ev.miles * frac
            miles += seg_miles
            totals[ev.status] += ov_e - ov_s

            seg = {
                "start_min": ov_s - day_start,
                "end_min": ov_e - day_start,
                "status": ev.status,
                "kind": ev.kind,
                "stop_id": ev.stop_id,
                "continues_from_prev": ev.start < day_start,
                "continues_next_day": ev.end > day_end,
                "miles": round(seg_miles, 1),
            }
            # Merge runs of the same status (15-min slices, or OFF into
            # OFF across an internal rest boundary) into one segment.
            if segments and segments[-1]["status"] == ev.status:
                prev = segments[-1]
                prev["end_min"] = seg["end_min"]
                prev["miles"] = round(prev["miles"] + seg["miles"], 1)
                prev["continues_next_day"] = seg["continues_next_day"]
                if seg["stop_id"] is not None:
                    prev["stop_id"] = seg["stop_id"]
            else:
                segments.append(seg)

            # A remark belongs to the day that contains the status change
            # (the event's own start). OFF->SB inside one rest shares the
            # rest's remark, so only the rest's first event carries it.
            if ev.remark and day_start <= ev.start < day_end:
                stop = stops_by_id.get(ev.stop_id)
                if stop is None or not stop.city:
                    stop = _stop_at(plan, ev.start) or stop
                remarks.append({
                    "time_min": ev.start - day_start,
                    "seg_start_min": ov_s - day_start,
                    "seg_end_min": ov_e - day_start,
                    "activity": ev.remark,
                    "bracket": ev.bracket,
                    "stop_id": ev.stop_id if ev.stop_id is not None
                        else (stop.id if stop else None),
                    "city": stop.city if stop else None,
                    "state": stop.state if stop else None,
                })

        segments.sort(key=lambda s: s["start_min"])
        remarks.sort(key=lambda r: r["time_min"])

        # --- recap (70 hr / 8 day column, labeled as on the paper form) ---
        last_restart_end = max((r for r in restart_ends if r <= day_end),
                               default=None)

        def window_on_duty(n):
            """On-duty minutes in the last n days including today.

            A 34-hr restart inside the window zeroes everything before it.
            Otherwise the prior cycle hours count in full while the window
            reaches back before the trip: their day-by-day split is unknown,
            so this errs conservative.
            """
            start = day_end - n * DAY
            if last_restart_end is not None and last_restart_end > start:
                return _on_duty_between(plan, last_restart_end, day_end)
            prior = cycle_used_minutes if start < 0 else 0
            return prior + _on_duty_between(plan, start, day_end)

        a = round(window_on_duty(7) / 60.0, 2)
        c = round(window_on_duty(5) / 60.0, 2)
        on_today = round(_on_duty_between(plan, day_start, day_end) / 60.0, 2)

        # from/to: city of the stop containing day bounds (fallback: ends)
        from_loc = _loc_at(plan, day_start, fallback="first")
        to_loc = _loc_at(plan, day_end, fallback="last")

        days.append({
            "date": date.isoformat(),
            "from": from_loc,
            "to": to_loc,
            "miles_driving": int(round(miles)),
            "segments": segments,
            "totals": {
                "off_min": totals[STATUS_OFF], "sb_min": totals[STATUS_SB],
                "driving_min": totals[STATUS_D], "on_min": totals[STATUS_ON],
                "off": _fmt_hm(totals[STATUS_OFF]),
                "sb": _fmt_hm(totals[STATUS_SB]),
                "driving": _fmt_hm(totals[STATUS_D]),
                "on": _fmt_hm(totals[STATUS_ON]),
                "sum": _fmt_hm(sum(totals.values())),
            },
            "on_duty_decimal": round(
                (totals[STATUS_D] + totals[STATUS_ON]) / 60.0, 2),
            "remarks": remarks,
            "recap": {
                "on_duty_today": on_today,
                "a": a,
                "b": round(max(0.0, 70.0 - a), 2),
                "c": c,
            },
        })
    return days


def _on_duty_between(plan, start, end):
    """On-duty (driving + on-duty-not-driving) minutes inside [start, end)."""
    return sum(
        max(0, min(e.end, end) - max(e.start, start))
        for e in plan.events
        if e.status in ON_DUTY
    )


def _stop_at(plan, t):
    """The stop containing time t, else the nearest one before it."""
    containing = [s for s in plan.stops if s.start <= t < s.end]
    if containing:
        return containing[0]
    before = [s for s in plan.stops if s.start <= t]
    return before[-1] if before else (plan.stops[0] if plan.stops else None)


def _loc_at(plan, t, fallback):
    """City/state label of the stop containing time t (or nearest before)."""
    s = _stop_at(plan, t)
    if s is None or not s.city:
        return "N/A"
    return f"{s.city}, {s.state}" if s.state else s.city
