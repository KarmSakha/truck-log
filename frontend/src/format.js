export function fmtHM(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function fmtClock(min) {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h24 < 12 ? "a" : "p";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")}${ap}`;
}

export function fmtClock24(min) {
  const h24 = Math.floor(min / 60) % 24;
  return `${String(h24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function fmtDateLabel(iso) {
  const d = new Date(iso + "T12:00:00");
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

/* Trip minutes count from day-0 midnight in home-terminal time, the same
   clock the log sheets use (not the viewer's browser timezone). */
export function fmtTripTime(min) {
  return `Day ${Math.floor(min / 1440) + 1} · ${fmtClock(min % 1440)}`;
}

export function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtWeekday(iso) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export const STATUS_META = {
  OFF: { label: "Off duty", color: "#8b93a1", row: 0 },
  SB: { label: "Sleeper berth", color: "#6e7aa8", row: 1 },
  D: { label: "Driving", color: "#e8a317", row: 2 },
  ON: { label: "On duty (not driving)", color: "#c45c26", row: 3 },
};

/* fill = marker badge colour; tone = the same hue lifted for text on the
   dark UI (>= 4.5:1 on --night-900). Pickup green / delivery coral follow
   Spotter's driver-app convention. */
export const STOP_KIND_META = {
  start: { glyph: "here", label: "Current", fill: "#40e0d0", tone: "#7ee8dc" },
  pre_trip: { glyph: "clipboard", label: "Pre-trip", fill: "#475569", tone: "#aab4c3" },
  pickup: { glyph: "P", label: "Pickup", fill: "#10b981", tone: "#34d399" },
  dropoff: { glyph: "D", label: "Dropoff", fill: "#f84960", tone: "#ff7a8a" },
  fuel: { glyph: "fuel", label: "Fuel", fill: "#f08a24", tone: "#f5a54f" },
  break: { glyph: "pause", label: "30-min break", fill: "#64748b", tone: "#aab4c3" },
  rest: { glyph: "berth", label: "10-hr rest", fill: "#6e7aa8", tone: "#a3add6" },
  restart_34: { glyph: "restart", label: "34-hr restart", fill: "#b42318", tone: "#ff7a8a" },
  post_trip: { glyph: "clipboard", label: "Post-trip", fill: "#475569", tone: "#aab4c3" },
};
