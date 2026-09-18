import { STOP_KIND_META } from "../format.js";
import { GLYPHS } from "../glyphs.js";

/* pre/post-trip sit on top of the start/dropoff dots, so they're left out */
const SHOWN = new Set(["start", "pickup", "fuel", "break", "rest", "restart_34", "dropoff"]);

/* Whole-trip progress line (Spotter driver-app style): stops placed by
   route mile, the open day highlighted, the replay position as a tick. */
export default function TripStrip({
  stops, totalMiles, day, dayRange, truckMile, litStop, onItemHover, onItemPick,
}) {
  if (!totalMiles) return null;
  const frac = (m) => Math.min(1, Math.max(0, m / totalMiles));
  const pct = (m) => `${frac(m) * 100}%`;

  return (
    <div className="trip-strip" role="group" aria-label="Trip progress by mile">
      <span className="ts-truck" aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: GLYPHS.truck }} />
      <div className="ts-track">
        <div className="ts-line" />
        {dayRange && (
          <div
            className="ts-day"
            style={{
              left: pct(dayRange[0]),
              width: `${Math.max(0.6, (frac(dayRange[1]) - frac(dayRange[0])) * 100)}%`,
            }}
            title={`Day ${day + 1}: mile ${Math.round(dayRange[0])}–${Math.round(dayRange[1])}`}
          />
        )}
        {stops.filter((s) => SHOWN.has(s.type)).map((s) => {
          const meta = STOP_KIND_META[s.type] || STOP_KIND_META.start;
          const place = [s.city, s.state].filter(Boolean).join(", ");
          const label = `${meta.label}${place ? `, ${place}` : ""}, day ${Math.floor(s.start_min / 1440) + 1}`;
          return (
            <button
              key={s.id}
              type="button"
              className={`ts-dot ${s.type} ${litStop === s.id ? "lit" : ""}`}
              style={{ left: pct(s.route_mile), "--fill": meta.fill }}
              onMouseEnter={() => onItemHover(s)}
              onMouseLeave={() => onItemHover(null)}
              onFocus={() => onItemHover(s)}
              onBlur={() => onItemHover(null)}
              onClick={() => onItemPick(s)}
              aria-label={label}
              title={label}
            />
          );
        })}
        {truckMile != null && (
          <span className="ts-now" style={{ left: pct(truckMile) }} aria-hidden="true" />
        )}
      </div>
      <span className="ts-miles">{Math.round(totalMiles).toLocaleString()} mi</span>
    </div>
  );
}
