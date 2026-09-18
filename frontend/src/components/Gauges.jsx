import { useEffect, useRef, useState } from "react";

function useCountUp(target, dur = 700, key) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const from = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      setV(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, key, dur]);
  return v;
}

function Gauge({ label, usedMin, maxMin, suffix, fillClass }) {
  const remaining = Math.max(0, maxMin - usedMin);
  const shown = useCountUp(remaining / 60, 800, usedMin);
  const frac = maxMin ? Math.max(0, Math.min(1, usedMin / maxMin)) : 0;
  return (
    <div className={`gauge ${frac > 0.85 ? "warn" : ""}`}>
      <div className="g-label">
        <span>{label}</span>
        <span className="g-value">
          {shown.toFixed(1)} <small>h left{suffix || ""}</small>
        </span>
      </div>
      <div className="g-bar">
        <div
          className={`g-fill ${fillClass || ""}`}
          style={{ width: `${(1 - frac) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function Gauges({ summary }) {
  const g = summary?.gauges || {};
  const windowUsed = g.window_elapsed_min ?? 0;
  return (
    <div className="instruments" role="group" aria-label="HOS gauges">
      <Gauge label="11h driving" usedMin={g.drive_used_min || 0} maxMin={660} />
      <Gauge label="14h window" usedMin={windowUsed} maxMin={840}
        suffix={g.window_elapsed_min == null ? " (reset)" : ""} />
      <Gauge label="70h cycle" usedMin={g.cycle_used_min || 0} maxMin={4200} />
      <div className="stat-chip">
        <span className="s-label">Miles</span>
        <span className="s-value">{summary.total_miles.toLocaleString()}</span>
      </div>
      <div className="stat-chip">
        <span className="s-label">Sheets</span>
        <span className="s-value">{summary.days} day{summary.days > 1 ? "s" : ""}</span>
      </div>
      <div className="stat-chip">
        <span className="s-label">Stops</span>
        <span className="s-value">
          {summary.fuel_stops} fuel · {summary.rests} rest
        </span>
      </div>
      {summary.restarts_34 > 0 && (
        <div className="stat-chip stamp">
          <span className="s-label">Stamp</span>
          <span className="s-value">34-HR RESTART</span>
        </div>
      )}
    </div>
  );
}
