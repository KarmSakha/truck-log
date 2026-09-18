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

export function fmtStopTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const ap = h < 12 ? "a" : "p";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(d.getMinutes()).padStart(2, "0")}${ap}`;
}

export function fmtStopDay(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export const STATUS_META = {
  OFF: { label: "Off duty", color: "#8b93a1", row: 0 },
  SB: { label: "Sleeper berth", color: "#6e7aa8", row: 1 },
  D: { label: "Driving", color: "#e8a317", row: 2 },
  ON: { label: "On duty (not driving)", color: "#c45c26", row: 3 },
};

export const STOP_KIND_META = {
  start: { glyph: "diamond", label: "Current" },
  pre_trip: { glyph: "clipboard", label: "Pre-trip" },
  pickup: { glyph: "P", label: "Pickup" },
  dropoff: { glyph: "D", label: "Dropoff" },
  fuel: { glyph: "fuel", label: "Fuel" },
  break: { glyph: "pause", label: "30-min break" },
  rest: { glyph: "berth", label: "10-hr rest" },
  restart_34: { glyph: "restart", label: "34-hr restart" },
  post_trip: { glyph: "clipboard", label: "Post-trip" },
};
