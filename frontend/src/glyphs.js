import { STOP_KIND_META } from "./format.js";

/* map + itinerary glyphs (inline SVG strings) */
export const GLYPHS = {
  diamond: `<svg width="18" height="18" viewBox="0 0 18 18"><rect x="4" y="4" width="10" height="10" transform="rotate(45 9 9)" fill="#0c1220" stroke="#c5cdd8" stroke-width="2"/></svg>`,
  P: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="1.5" y="1.5" width="17" height="17" rx="3" fill="#0c1220" stroke="#e8a317" stroke-width="2"/><text x="10" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#e8a317" font-family="IBM Plex Sans Condensed,sans-serif">P</text></svg>`,
  D: `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="1.5" y="1.5" width="17" height="17" rx="3" fill="#0c1220" stroke="#e8edf4" stroke-width="2"/><text x="10" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#e8edf4" font-family="IBM Plex Sans Condensed,sans-serif">D</text></svg>`,
  fuel: `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 1.5 C9 1.5 4 8 4 11.5 a5 5 0 0 0 10 0 C14 8 9 1.5 9 1.5Z" fill="#0c1220" stroke="#c45c26" stroke-width="2"/><circle cx="9" cy="11.5" r="1.6" fill="#c45c26"/></svg>`,
  pause: `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M11 2 A8 8 0 1 0 16 9 A6.5 6.5 0 0 1 11 2Z" fill="#0c1220" stroke="#8b93a1" stroke-width="2"/></svg>`,
  berth: `<svg width="20" height="18" viewBox="0 0 20 18"><rect x="1.5" y="3.5" width="17" height="11" rx="2" fill="#0c1220" stroke="#6e7aa8" stroke-width="2"/><line x1="4.5" y1="6.5" x2="15.5" y2="6.5" stroke="#6e7aa8" stroke-width="1.6"/></svg>`,
  restart: `<svg width="20" height="18" viewBox="0 0 20 18"><rect x="2" y="3" width="4.5" height="12" rx="1" fill="#b42318" opacity="0.85"/><rect x="9" y="3" width="4.5" height="12" rx="1" fill="#b42318" opacity="0.85"/><rect x="15" y="3" width="4.5" height="12" rx="1" fill="#b42318" opacity="0.4"/></svg>`,
  clipboard: `<svg width="16" height="18" viewBox="0 0 16 18"><rect x="1.5" y="2.5" width="13" height="14" rx="2" fill="#0c1220" stroke="#c45c26" stroke-width="1.8"/><rect x="5" y="1" width="6" height="3" rx="1" fill="#c45c26"/></svg>`,
  truck: `<svg width="26" height="18" viewBox="0 0 26 18"><rect x="1" y="3" width="14" height="9" rx="1" fill="#e8a317"/><rect x="16" y="6" width="8" height="6" rx="1" fill="#e8a317"/><circle cx="6" cy="14" r="2.4" fill="#0c1220" stroke="#e8edf4" stroke-width="1"/><circle cx="19" cy="14" r="2.4" fill="#0c1220" stroke="#e8edf4" stroke-width="1"/></svg>`,
};

export function stopGlyph(type) {
  const meta = STOP_KIND_META[type] || STOP_KIND_META.start;
  return GLYPHS[meta.glyph] || GLYPHS.diamond;
}
