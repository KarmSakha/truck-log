import { useEffect, useMemo, useRef, useState } from "react";
import LogSheet from "./LogSheet.jsx";
import { fmtDateLabel } from "../format.js";

export default function LogBook({
  logs, meta, activeDay, onDayChange, highlightMin, onSegmentHover,
  replaying, replayTime, onReplayStart, onReplayStop,
}) {
  const reduced = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    []
  );

  const [ink, setInk] = useState(reduced ? 1 : 0);
  const raf = useRef(0);

  // first-load ink draw for the active sheet
  useEffect(() => {
    if (replaying || reduced) { setInk(1); return; }
    setInk(0);
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

  // during replay: ink follows the replay clock
  const inkNow = replaying
    ? Math.min(1, Math.max(0, replayTime / 1440))
    : ink;

  return (
    <div className="logbook-pane">
      <div className="logbook-head">
        <div className="day-tabs" role="tablist" aria-label="Log days">
          {logs.map((l, i) => (
            <button
              key={l.date}
              role="tab"
              aria-selected={i === activeDay}
              className={`day-tab ${i === activeDay ? "active" : ""}`}
              onClick={() => onDayChange(i)}
            >
              Day {i + 1} · {fmtDateLabel(l.date)}
            </button>
          ))}
        </div>
        <div className="logbook-actions">
          <button
            className={`mini-btn ${replaying ? "replaying" : ""}`}
            onClick={replaying ? onReplayStop : onReplayStart}
            title="Replay this day"
          >
            {replaying ? "■ Stop" : "▶ Replay"}
          </button>
          <button
            className="mini-btn"
            onClick={(e) => {
              navigator.clipboard?.writeText(window.location.href);
              const b = e.currentTarget;
              b.textContent = "✓ Copied";
              setTimeout(() => { b.textContent = "⧉ Copy link"; }, 1400);
            }}
            title="Copy shareable trip URL"
          >
            ⧉ Copy link
          </button>
          <button className="mini-btn" onClick={() => window.print()}>
            ⎙ Print
          </button>
        </div>
      </div>

      <div className="logbook-scroll">
        <div className="sheet-stack">
          {logs.length > 1 && <div className="peek-sheet" aria-hidden="true" />}
          {logs.map((l, i) => (
            <div
              key={l.date}
              className={`paper-sheet ${i === activeDay ? "" : "hidden-sheet"}`}
            >
              <LogSheet
                log={l}
                meta={meta}
                inkProgress={i === activeDay ? inkNow : 1}
                highlightMin={i === activeDay ? highlightMin : null}
                onSegmentHover={i === activeDay ? onSegmentHover : null}
              />
              {/* accessible table of segments */}
              <details className="sr-segments" style={{
                position: "absolute", left: 0, top: 0, width: 1, height: 1,
                overflow: "hidden",
              }}>
                <summary>Segment list</summary>
                <table>
                  <tbody>
                    {l.segments.map((s, j) => (
                      <tr key={j}>
                        <td>{s.start_min}–{s.end_min}</td>
                        <td>{s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          ))}
        </div>
      </div>

      <div className="legend-strip">
        <span className="lg"><span className="sw" style={{ background: "#8b93a1" }} />OFF DUTY</span>
        <span className="lg"><span className="sw" style={{ background: "#6e7aa8" }} />SLEEPER</span>
        <span className="lg"><span className="sw" style={{ background: "#e8a317" }} />DRIVING</span>
        <span className="lg"><span className="sw" style={{ background: "#c45c26" }} />ON DUTY</span>
        <span className="lg" style={{ marginLeft: "auto" }}
          title="Prior cycle hours are not aged off day-by-day because daily history was not provided.">
          70h/8d · property-carrying · home-terminal time · prior hours not aged off
        </span>
      </div>
    </div>
  );
}
