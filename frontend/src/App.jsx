import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DispatchTicket from "./components/DispatchTicket.jsx";
import Gauges from "./components/Gauges.jsx";
import LogBook from "./components/LogBook.jsx";
import RouteMap from "./components/RouteMap.jsx";
import { fetchTrip, planTrip } from "./api.js";
import { fmtClock, fmtWeekday } from "./format.js";

const SAMPLE = {
  current: "Chicago, IL",
  pickup: "Dallas, TX",
  dropoff: "Houston, TX",
  cycle: 20,
};

const EMPTY = {
  current: "", pickup: "", dropoff: "", cycle: 20,
  startTime: "", tz: "America/Chicago",
  carrier: "", driver: "", coDriver: "",
  tractor: "", trailer: "", shipper: "", commodity: "",
};

/* cumulative haversine miles over the route geometry */
function cumMiles(geometry) {
  const R = 3958.8;
  const out = [0];
  for (let i = 1; i < geometry.length; i++) {
    const [a, b] = [geometry[i - 1], geometry[i]];
    const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180;
    const dl = ((b[1] - a[1]) * Math.PI) / 180;
    const dn = ((b[0] - a[0]) * Math.PI) / 180;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dn / 2) ** 2;
    out.push(out[i - 1] + 2 * R * Math.asin(Math.sqrt(h)));
  }
  return out;
}

export default function App() {
  const [phase, setPhase] = useState("landing");
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [planning, setPlanning] = useState(false);
  const [planStep, setPlanStep] = useState(0);
  const [toast, setToast] = useState(null);
  const [trip, setTrip] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [litStop, setLitStop] = useState(null); // stop id
  const [litMin, setLitMin] = useState(null);   // grid column to flash
  const [replaying, setReplaying] = useState(false);
  const [replayTime, setReplayTime] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const [wide, setWide] = useState(false);       // log pane expanded
  const [mapFocus, setMapFocus] = useState(null); // stop picked in itinerary
  const replayRaf = useRef(0);
  const stepTimer = useRef(0);

  /* ---------- shareable URL ---------- */
  useEffect(() => {
    const m = window.location.pathname.match(/^\/trips\/([0-9a-f-]{36})\/?$/);
    if (m) {
      fetchTrip(m[1])
        .then((t) => {
          setTrip(t);
          setValues((v) => ({
            ...v,
            current: t.input.current_location,
            pickup: t.input.pickup_location,
            dropoff: t.input.dropoff_location,
            cycle: t.input.current_cycle_used_hours,
          }));
          setPhase("results");
          setRevealKey((k) => k + 1);
        })
        .catch(() => setToast("Couldn't load that trip"));
    }
  }, []);

  /* ---------- route position helpers ---------- */
  const geo = useMemo(() => {
    if (!trip) return null;
    const cum = cumMiles(trip.route.geometry);
    const total = cum[cum.length - 1];
    const totalRouteMiles = trip.route.legs.reduce((a, l) => a + l.miles, 0);
    const mileToLngLat = (routeMile) => {
      const target = totalRouteMiles
        ? (routeMile / totalRouteMiles) * total
        : 0;
      if (target <= 0) return trip.route.geometry[0];
      if (target >= total) return trip.route.geometry[trip.route.geometry.length - 1];
      let lo = 0, hi = cum.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid; else hi = mid;
      }
      const span = cum[hi] - cum[lo] || 1;
      const f = (target - cum[lo]) / span;
      const [x1, y1] = trip.route.geometry[lo];
      const [x2, y2] = trip.route.geometry[hi];
      return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
    };
    // time (absolute minutes since day0) -> route mile via consecutive stops
    const timeToMile = (tAbs) => {
      const stops = trip.stops;
      if (tAbs <= stops[0].end_min) return stops[0].route_mile;
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (tAbs < b.start_min) {
          const span = b.start_min - a.end_min || 1;
          const f = Math.min(1, Math.max(0, (tAbs - a.end_min) / span));
          return a.route_mile + (b.route_mile - a.route_mile) * f;
        }
      }
      return stops[stops.length - 1].route_mile;
    };
    return { mileToLngLat, timeToMile };
  }, [trip]);

  /* ---------- submit ---------- */
  const submit = useCallback(async (override) => {
    const vals = override || values;
    const e = {};
    if (!vals.current.trim()) e.current_location = "Where is the truck now?";
    if (!vals.pickup.trim()) e.pickup_location = "Pickup is required";
    if (!vals.dropoff.trim()) e.dropoff_location = "Dropoff is required";
    setErrors(e);
    if (Object.keys(e).length) return;

    setPlanning(true);
    setToast(null);
    setPlanStep(0);
    stepTimer.current = setInterval(
      () => setPlanStep((s) => Math.min(2, s + 1)), 1400
    );
    try {
      const t = await planTrip({
        current_location: vals.current,
        pickup_location: vals.pickup,
        dropoff_location: vals.dropoff,
        current_cycle_used_hours: vals.cycle,
        start_time: vals.startTime || undefined,
        timezone: vals.tz,
        carrier: vals.carrier || undefined,
        driver: vals.driver || undefined,
        co_driver: vals.coDriver || undefined,
        tractor: vals.tractor || undefined,
        trailer: vals.trailer || undefined,
        shipper: vals.shipper || undefined,
        commodity: vals.commodity || undefined,
      });
      setTrip(t);
      setActiveDay(0);
      setPhase("results");
      setRevealKey((k) => k + 1);
      if (t.id) window.history.pushState({}, "", `/trips/${t.id}/`);
    } catch (err) {
      if (err.field && err.field !== "route" && err.field !== "body") {
        setErrors({ [err.field]: err.message });
      } else {
        setToast(err.message || "Route service is down");
      }
    } finally {
      setPlanning(false);
      clearInterval(stepTimer.current);
      setPlanStep(0);
    }
  }, [values]);

  const loadSample = useCallback(async () => {
    // sequential fill so the spine visibly populates
    const fields = ["current", "pickup", "dropoff"];
    for (const f of fields) {
      await new Promise((r) => setTimeout(r, 90));
      setValues((v) => ({ ...v, [f]: SAMPLE[f], cycle: SAMPLE.cycle }));
    }
    setTimeout(() => submit(SAMPLE), 240);
  }, [submit]);

  /* ---------- map <-> log linking ---------- */
  const onStopHover = useCallback((stopId) => {
    setLitStop(stopId);
    if (stopId == null || !trip) { setLitMin(null); return; }
    const s = trip.stops.find((x) => x.id === stopId);
    if (!s) { setLitMin(null); return; }
    const day = Math.floor(s.start_min / 1440);
    setActiveDay(day);
    setLitMin(s.start_min - day * 1440);
  }, [trip]);

  const onStopClick = useCallback((s) => {
    const day = Math.floor(s.start_min / 1440);
    setActiveDay(day);
    setLitMin(s.start_min - day * 1440);
  }, []);

  const onSegmentHover = useCallback((stopId) => {
    setLitStop(stopId);
    if (stopId == null) setLitMin(null);
  }, []);

  // itinerary rows stay on the open day (a rest that began yesterday
  // lights the top of today's grid instead of flipping the tab back)
  const onItemHover = useCallback((s) => {
    if (!s) { setLitStop(null); setLitMin(null); return; }
    setLitStop(s.id);
    setLitMin(Math.max(0, s.start_min - activeDay * 1440));
  }, [activeDay]);

  const onItemPick = useCallback((s) => {
    onItemHover(s);
    if (s.lat != null) setMapFocus({ lat: s.lat, lng: s.lng });
  }, [onItemHover]);

  const arrival = useMemo(() => {
    const d = trip?.stops.find((s) => s.type === "dropoff");
    if (!d) return null;
    const day = Math.floor(d.start_min / 1440);
    const date = trip.logs[day]?.date;
    return {
      time: fmtClock(d.start_min % 1440),
      day: `Day ${day + 1}${date ? " · " + fmtWeekday(date) : ""}`,
    };
  }, [trip]);

  /* ---------- replay ---------- */
  const stopReplay = useCallback(() => {
    cancelAnimationFrame(replayRaf.current);
    setReplaying(false);
    setReplayTime(0);
  }, []);

  const startReplay = useCallback(() => {
    setReplaying(true);
    setReplayTime(0);
    const t0 = performance.now();
    const DUR = 10000; // ~10s per day
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      setReplayTime(p * 1440);
      if (p < 1) replayRaf.current = requestAnimationFrame(tick);
      else setReplaying(false);
    };
    replayRaf.current = requestAnimationFrame(tick);
  }, []);

  const scrubReplay = useCallback((t) => {
    setReplayTime(t);
  }, []);

  useEffect(() => () => cancelAnimationFrame(replayRaf.current), []);

  const truckPos = useMemo(() => {
    if (!replaying || !geo || !trip) return null;
    const abs = activeDay * 1440 + replayTime;
    return geo.mileToLngLat(geo.timeToMile(abs));
  }, [replaying, replayTime, geo, trip, activeDay]);

  /* ---------- render ---------- */
  return (
    <div className="app" data-phase={phase} data-wide={wide || undefined}
      data-busy={planning || undefined}>
      {planning && <div className="top-progress" role="progressbar" aria-label="Planning trip" />}
      {phase === "results" && trip && (
        <>
          <DispatchTicket
            phase={phase}
            values={values}
            setValues={setValues}
            errors={errors}
            setErrors={setErrors}
            onSubmit={() => submit()}
            onSample={loadSample}
            planning={planning}
            planStep={planStep}
            toast={toast}
            onRetry={() => submit()}
          />
          <Gauges summary={trip.summary} arrival={arrival} />
        </>
      )}

      {/* ONE map instance lives across both phases — CSS morphs it */}
      <div className="stage">
        <div className="map-pane">
          <RouteMap
            route={trip?.route || null}
            stops={trip?.stops || []}
            litStop={litStop}
            onStopHover={onStopHover}
            onStopClick={onStopClick}
            truckPos={truckPos}
            revealKey={revealKey}
            focus={mapFocus}
          />
          {phase === "results" && replaying && (
            <div className="replay-bar">
              <button type="button" className="mini-btn" onClick={stopReplay}
                aria-label="Stop replay">■</button>
              <span className="rb-time">
                Day {activeDay + 1} · {fmtClock(Math.floor(replayTime))}
              </span>
              <input
                type="range" min={0} max={1440} step={15}
                value={Math.floor(replayTime)}
                onChange={(e) => scrubReplay(+e.target.value)}
                aria-label="Replay scrub"
              />
            </div>
          )}
        </div>
        {phase === "results" && trip && (
          <LogBook
            logs={trip.logs}
            meta={trip.meta}
            stops={trip.stops}
            litStop={litStop}
            onItemHover={onItemHover}
            onItemPick={onItemPick}
            wide={wide}
            onToggleWide={() => setWide((w) => !w)}
            activeDay={activeDay}
            onDayChange={(d) => { setActiveDay(d); stopReplay(); }}
            highlightMin={litMin}
            onSegmentHover={onSegmentHover}
            replaying={replaying}
            replayTime={replayTime}
            onReplayStart={startReplay}
            onReplayScrub={scrubReplay}
            onReplayStop={stopReplay}
          />
        )}
      </div>

      {phase === "landing" && (
        <DispatchTicket
          phase={phase}
          values={values}
          setValues={setValues}
          errors={errors}
          setErrors={setErrors}
          onSubmit={() => submit()}
          onSample={loadSample}
          planning={planning}
          planStep={planStep}
          toast={toast}
          onRetry={() => submit()}
        />
      )}
    </div>
  );
}
