import { fmtDur } from "../format.js";

function Gauge({ label, usedMin, maxMin, suffix, fillClass }) {
  const remaining = Math.max(0, maxMin - usedMin);

  const frac = maxMin ? Math.max(0, Math.min(1, usedMin / maxMin)) : 0;
  return (
    <div className={`gauge ${frac > 0.85 ? "warn" : ""}`}>
      <div className="g-label">
        <span>{label}</span>
        <span className="g-value">
          {fmtDur(remaining)} <small>left{suffix || ""}</small>
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

export default function Gauges({ summary, arrival }) {
  const g = summary?.gauges || {};
  const windowUsed = g.window_elapsed_min ?? 0;
  return (
    <div className="instruments" role="group" aria-label="HOS clocks after unloading and post-trip inspection">
      <div className="inst-tag" aria-hidden="true">
        <span>Clocks</span><span>at finish</span>
      </div>
      <Gauge label="11h driving" usedMin={g.drive_used_min || 0} maxMin={660} />
      <Gauge label="14h window" usedMin={windowUsed} maxMin={840}
        suffix={g.window_elapsed_min == null ? " (reset)" : ""} />
      <Gauge label="70h cycle" usedMin={g.cycle_used_min || 0} maxMin={4200} />
      <div className="stat-chip">
        <span className="s-label">Miles</span>
        <span className="s-value">{summary.total_miles.toLocaleString()}</span>
        <span className="s-sub">{fmtDur(summary.total_driving_minutes)} driving</span>
      </div>
      {arrival && (
        <div className="stat-chip">
          <span className="s-label">Arrive</span>
          <span className="s-value">{arrival.time}</span>
          <span className="s-sub">{arrival.day}</span>
        </div>
      )}
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
