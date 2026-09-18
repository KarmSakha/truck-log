import { STOP_KIND_META } from "./format.js";

/* Map + itinerary glyphs (inline SVG strings): filled round badges with a
   white icon and a dark keyline so they read on the dark basemap. */
const WHITE = "#ffffff";
const badge = (fill, inner) =>
  `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.6" fill="${fill}" stroke="#0c1220" stroke-width="2"/>${inner}</svg>`;
const letter = (ch) =>
  `<text x="11" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="${WHITE}" font-family="DM Sans,sans-serif">${ch}</text>`;
const line = (d, w = 1.5) =>
  `<path d="${d}" fill="none" stroke="${WHITE}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const ICONS = {
  here: () =>
    `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.6" fill="#0c1220" stroke="${STOP_KIND_META.start.fill}" stroke-width="2"/><circle cx="11" cy="11" r="3.6" fill="${STOP_KIND_META.start.fill}"/></svg>`,
  P: (f) => badge(f, letter("P")),
  D: (f) => badge(f, letter("D")),
  fuel: (f) => badge(f,
    line("M7.6 16V7.2a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1V16M7 16h6.4M8.8 9.2h2.8")
    + line("M12.8 9.6h1.1l1.1 1.3v3.3a.75.75 0 0 0 1.5 0V9l-1.1-1.3", 1.3)),
  pause: (f) => badge(f,
    `<rect x="8" y="7" width="2.1" height="8" rx=".7" fill="${WHITE}"/><rect x="11.9" y="7" width="2.1" height="8" rx=".7" fill="${WHITE}"/>`),
  berth: (f) => badge(f,
    line("M6.2 15V8.2M6.2 12.4h9.6V15M15.8 12.4v-1.6a1.4 1.4 0 0 0-1.4-1.4H10.4v3")
    + `<circle cx="8.4" cy="10.6" r="1.2" fill="${WHITE}"/>`),
  restart: (f) => badge(f,
    `<text x="11" y="14.6" text-anchor="middle" font-size="8.6" font-weight="700" fill="${WHITE}" font-family="DM Sans,sans-serif">34</text>`),
  clipboard: (f) => badge(f,
    line("M8 6.6h6a.8.8 0 0 1 .8.8v8a.8.8 0 0 1-.8.8H8a.8.8 0 0 1-.8-.8v-8a.8.8 0 0 1 .8-.8zM9.4 6.6V5.8h3.2v.8M9.2 10h3.6M9.2 12.6h2.4", 1.3)),
};

export const GLYPHS = {
  truck: `<svg width="26" height="18" viewBox="0 0 26 18"><rect x="1" y="3" width="14" height="9" rx="1.5" fill="#40e0d0"/><path d="M16 6h4.6l3 3.2V12H16z" fill="#40e0d0"/><circle cx="6" cy="14" r="2.4" fill="#0c1220" stroke="#e8edf4" stroke-width="1"/><circle cx="19" cy="14" r="2.4" fill="#0c1220" stroke="#e8edf4" stroke-width="1"/></svg>`,
};

export function stopGlyph(type) {
  const meta = STOP_KIND_META[type] || STOP_KIND_META.start;
  return (ICONS[meta.glyph] || ICONS.here)(meta.fill);
}
