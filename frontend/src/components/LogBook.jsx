import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import LogSheet from "./LogSheet.jsx";
import {
  fmtClock, fmtDateLabel, fmtDur, fmtWeekday, STATUS_META, STOP_KIND_META,
} from "../format.js";
import { stopGlyph } from "../glyphs.js";

const DAY = 1440;

function DayItinerary({ log, day, stops, litStop, onItemHover, onItemPick }) {
  const dayStart = day * DAY;
  const items = stops.filter(
    (s) => s.end_min > dayStart && s.start_min < dayStart + DAY
  );
  const rows = [];
  items.forEach((s, i) => {
    const prev = items[i - 1];
    if (prev) {
      const miles = s.route_mile - prev.route_mile;
      if (miles > 0.5) {
        rows.push(
          <li key={`d${s.id}`} className="it-drive" aria-hidden="true">
            <span className="it-rail" />
            Drive · {Math.round(miles).toLocaleString()} mi · {fmtDur(s.start_min - prev.end_min)}
          </li>
        );
      }
    }
    const meta = STOP_KIND_META[s.type] || STOP_KIND_META.start;
    const place = [s.city, s.state].filter(Boolean).join(", ");
    const cont = s.start_min < dayStart;
    rows.push(
      <li key={s.id}>
        <button
          type="button"
          className={`it-row ${litStop === s.id ? "lit" : ""}`}
          style={{ "--st": STATUS_META[s.status]?.color }}
          onMouseEnter={() => onItemHover(s)}
          onMouseLeave={() => onItemHover(null)}
          onFocus={() => onItemHover(s)}
          onBlur={() => onItemHover(null)}
          onClick={() => onItemPick(s)}
          title="Show on map"
        >
          <span className="it-time">
            <span className="it-pill">{cont ? "cont." : fmtClock(s.start_min - dayStart)}</span>
          </span>
          <span className="it-glyph" aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: stopGlyph(s.type) }} />
          <span className="it-main">
            <span className="it-kind" style={{ color: meta.tone }}>{meta.label}</span>
            <span className="it-place">{place || "—"}</span>
          </span>
          <span className="it-dur">
            {s.duration_min ? fmtDur(s.duration_min) : ""}
          </span>
        </button>
      </li>
    );
  });

  return (
    <section className="day-panel" aria-label={`Day ${day + 1} summary`}>
      <header className="dp-head">
        <div>
          <div className="dp-kicker">Day {day + 1} · {fmtWeekday(log.date)}</div>
          <div className="dp-route">
            {log.from} <span aria-hidden="true">→</span>
            <span className="vh-only"> to </span> {log.to}
          </div>
        </div>
        <div className="dp-stats">
          <div><b>{log.miles_driving.toLocaleString()}</b> mi</div>
          <div><b>{log.on_duty_decimal}</b> h on duty</div>
        </div>
      </header>
      {rows.length > 0 ? (
        <ol className="itinerary">{rows}</ol>
      ) : (
        <p className="dp-empty">No stops this day — driving and rest only.</p>
      )}
    </section>
  );
}

export default function LogBook({
  logs, meta, stops, route, activeDay, onDayChange, highlightMin, onSegmentHover,
  replaying, replayTime, onReplayStart, onReplayStop,
  litStop, onItemHover, onItemPick, wide, onToggleWide,
}) {
  const reduced = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    []
  );

  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const [ink, setInk] = useState(reduced ? 1 : 0);
  const [copied, setCopied] = useState(null); // null | "ok" | "fail"
  const [zoomed, setZoomed] = useState(false);  // phones: readable sheet width
  const raf = useRef(0);
  const tabsRef = useRef(null);

  // first-load ink draw for the active sheet
  useEffect(() => {
    if (replaying || reduced) return;
    const t0 = performance.now();
    const dur = 1150;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      setInk(1 - Math.pow(1 - p, 3)); // ease-out cubic
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [activeDay, logs, replaying, reduced]);

  // keep the active tab in view (and focused, when using the keyboard)
  useEffect(() => {
    const box = tabsRef.current;
    const tab = box?.children[activeDay];
    if (!tab) return;
    box.scrollTo({
      left: tab.offsetLeft + tab.offsetWidth / 2 - box.clientWidth / 2,
      behavior: reduced ? "auto" : "smooth",
    });
    if (box.contains(document.activeElement)) tab.focus({ preventScroll: true });
  }, [activeDay, reduced]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const go = (d) => onDayChange(Math.min(logs.length - 1, Math.max(0, d)));
  const log = logs[activeDay];
  const t = log.totals;

  return (
    <div className="logbook-pane" id="daily-logs">
      <div className="logbook-title"><div><span className="eyebrow">YOUR TRIP, ON PAPER</span><h1>Daily logbook</h1></div><span className="sheet-count">{activeDay + 1} / {logs.length} <span>sheets</span></span></div>
      <div className="logbook-head">
        <div className="day-nav">
          <button type="button" className="nav-btn" onClick={() => go(activeDay - 1)}
            disabled={activeDay === 0} aria-label="Previous day">‹</button>
          <div
            className="day-tabs"
            role="tablist"
            aria-label="Log days"
            ref={tabsRef}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); go(activeDay + 1); }
              if (e.key === "ArrowLeft") { e.preventDefault(); go(activeDay - 1); }
              if (e.key === "Home") { e.preventDefault(); go(0); }
              if (e.key === "End") { e.preventDefault(); go(logs.length - 1); }
            }}
          >
            {logs.map((l, i) => (
              <button
                key={l.date}
                id={`day-tab-${i}`}
                role="tab"
                aria-selected={i === activeDay}
                aria-controls={`day-sheet-${i}`}
                tabIndex={i === activeDay ? 0 : -1}
                className={`day-tab ${i === activeDay ? "active" : ""}`}
                onClick={() => onDayChange(i)}
              >
                <span className="dt-n">Day {i + 1}</span>
                <span className="dt-d">{fmtDateLabel(l.date)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="nav-btn" onClick={() => go(activeDay + 1)}
            disabled={activeDay === logs.length - 1} aria-label="Next day">›</button>
        </div>
        <div className="logbook-actions">
          <button
            type="button"
            className={`mini-btn ${replaying ? "replaying" : ""}`}
            onClick={replaying ? onReplayStop : onReplayStart}
            title="Replay this day on the map and the log"
            aria-label={replaying ? "Stop replay" : "Replay this day"}
          >
            <span aria-hidden="true">{replaying ? "■" : "▶"}</span>
            <span className="mb-label">{replaying ? "Stop" : "Replay"}</span>
          </button>
          <button
            type="button"
            className={`mini-btn ${copied === "ok" ? "ok" : ""}`}
            onClick={() => {
              const p = navigator.clipboard?.writeText(window.location.href);
              if (p) p.then(() => setCopied("ok"), () => setCopied("fail"));
              else setCopied("fail");
            }}
            title="Copy a shareable link to this trip"
            aria-label="Copy shareable trip link"
          >
            <span aria-hidden="true">{copied === "ok" ? "✓" : "⧉"}</span>
            <span className="mb-label" aria-live="polite">
              {copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy link"}
            </span>
          </button>
          <button type="button" className="mini-btn" onClick={() => window.print()}
            title="Print every sheet" aria-label="Print all log sheets">
            <span aria-hidden="true">⎙</span>
            <span className="mb-label">Print</span>
          </button>
          <button type="button" className="mini-btn zoom-toggle"
            onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed}
            title={zoomed ? "Fit the sheet to the screen" : "Zoom the sheet to read it"}
            aria-label={zoomed ? "Fit log sheet to screen" : "Zoom log sheet"}>
            <span aria-hidden="true">{zoomed ? "⊖" : "⊕"}</span>
            <span className="mb-label">{zoomed ? "Fit" : "Zoom"}</span>
          </button>
          <button type="button" className="mini-btn wide-toggle" onClick={onToggleWide}
            aria-pressed={wide}
            title={wide ? "Back to map + log" : "Give the log more room"}
            aria-label={wide ? "Shrink log pane" : "Expand log pane"}>
            <span aria-hidden="true">{wide ? "⤡" : "⤢"}</span>
            <span className="mb-label">{wide ? "Split" : "Expand"}</span>
          </button>
        </div>
      </div>

      <div className="logbook-scroll">
        <div className="day-overview"><div><span className="eyebrow">{fmtWeekday(log.date)}</span><h2>{log.from} <span>→</span> {log.to}</h2></div><span className="day-total">24h <span>accounted for</span></span></div>
        <p className="sheet-help">Read your duty changes below. Select a stop to locate it on the map.</p>
        <div className={`sheet-viewport ${zoomed ? "zoomed" : ""}`}>
        {zoomed && <p className="zoom-hint" aria-hidden="true">Scroll sideways to read the whole sheet</p>}
        <div className="sheet-stack">
          {logs.length > 1 && <div className="peek-sheet" aria-hidden="true" />}
          {logs.map((l, i) => (
            <div
              key={l.date}
              id={`day-sheet-${i}`}
              role="tabpanel"
              aria-labelledby={`day-tab-${i}`}
              className={`paper-sheet ${i === activeDay ? "" : "hidden-sheet"}`}
            >
              <LogSheet
                log={l}
                meta={meta}
                inkProgress={!printing && i === activeDay && !reduced && !replaying ? ink : 1}
                inkMinute={!printing && i === activeDay && replaying ? replayTime : null}
                highlightMin={i === activeDay ? highlightMin : null}
                onSegmentHover={i === activeDay ? onSegmentHover : null}
              />
            </div>
          ))}
        </div>
        </div>

        <details className="trip-notes">
          <summary>Planning assumptions <span>How this trip is calculated</span></summary>
          <ul>
            <li>You start with a fresh 11-hour driving allowance and 14-hour window, after at least 10 hours off duty.</li>
            <li>Prior cycle hours stay counted until a 34-hour restart because a daily history was not supplied. Non-driving work can continue after the cycle is exhausted.</li>
            <li>Times use {meta?.timezone || "your home-terminal time zone"} and a 15-minute planning grid. Pickup and unloading each take one hour.</li>
            <li>Road directions use a general driving profile. Check truck restrictions, bridge clearances and access before driving.</li>
            <li>Fuel and rest markers are estimated positions along the route, not verified parking or fueling facilities. This is a planned log, not a record of actual duty.</li>
          </ul>
        </details>

        <DayItinerary
          key={activeDay}
          log={log}
          day={activeDay}
          stops={stops}
          litStop={litStop}
          onItemHover={onItemHover}
          onItemPick={onItemPick}
        />
        <details className="trip-notes route-directions">
          <summary>Road-by-road directions <span>Current → pickup → dropoff</span></summary>
          <p>Driving estimates exclude scheduled fuel, loading and rest stops. Follow the daily itinerary for your duty schedule.</p>
          {route?.legs?.some((leg) => leg.directions?.length) ? route.legs.map((leg, i) => (
            <section key={i} aria-label={i === 0 ? "Directions to pickup" : "Directions to dropoff"}>
              <h3>{i === 0 ? "To pickup" : "To dropoff"} <span>{Math.round(leg.miles).toLocaleString()} mi</span></h3>
              <ol>{leg.directions?.map((step, j) => <li key={j}><span>{step.instruction}</span><b>{step.miles < 0.1 ? "< 0.1" : step.miles.toFixed(1)} mi</b></li>)}</ol>
            </section>
          )) : <p>This saved trip predates road directions. Select Replan to generate an updated trip.</p>}
        </details>
      </div>

      <div className="legend-strip" aria-label={`Duty totals for day ${activeDay + 1}`}>
        {[
          ["OFF", "Off duty", "Off", t.off],
          ["SB", "Sleeper", "SB", t.sb],
          ["D", "Driving", "Drive", t.driving],
          ["ON", "On duty", "On", t.on],
        ].map(([k, label, short, v]) => (
          <span className="lg" key={k}>
            <span className="sw" style={{ background: STATUS_META[k].color }} />
            <span className="lg-long">{label}</span>
            <span className="lg-short">{short}</span>
            <b>{v}</b>
          </span>
        ))}
        <span className="lg lg-note"
          title="Prior cycle hours are not aged off day-by-day because daily history was not provided.">
          70h/8d · home-terminal time · prior hours not aged off
        </span>
      </div>
    </div>
  );
}
