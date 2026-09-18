import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { fmtStopTime, STOP_KIND_META } from "../format.js";

const DARK_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const GLYPHS = {
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

export default function RouteMap({
  route, stops, litStop, onStopHover, onStopClick,
  truckPos, revealKey,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  const truck = useRef(null);
  const tip = useRef(null);

  /* ------- init map once ------- */
  useEffect(() => {
    if (map.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: DARK_STYLE,
      center: [-96.5, 37.5],
      zoom: 3.4,
      attributionControl: { compact: true },
      interactive: true,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "route-deadhead", type: "line", source: "route",
        filter: ["==", ["get", "leg"], 0],
        paint: {
          "line-color": "#c5cdd8", "line-width": 2.2,
          "line-dasharray": [2.2, 1.8], "line-opacity": 0.75,
        },
        layout: { "line-cap": "round" },
      });
      m.addLayer({
        id: "route-loaded", type: "line", source: "route",
        filter: ["==", ["get", "leg"], 1],
        paint: { "line-color": "#e8a317", "line-width": 3.4, "line-opacity": 0.95 },
        layout: { "line-cap": "round" },
      });
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  /* ------- paint route + markers when a trip arrives ------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !route) return;

    const apply = () => {
      try {
      // clear old markers
      markers.current.forEach((mk) => mk.remove());
      markers.current.clear();
      tip.current?.remove();
      tip.current = null;

      const src = m.getSource("route");
      const coords = route.geometry;
      const l1 = route.legs[1];
      const leg0Coords = coords.slice(0, l1 ? l1.coord_start + 1 : coords.length);
      const leg1Coords = l1 ? coords.slice(l1.coord_start) : [];

      // fit bounds — the pane may still be morphing from landing size, so
      // re-fit shortly after the internal canvas resize settles.
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      const PAD = { top: 70, bottom: 70, left: 70, right: 70 };
      m.fitBounds(b, { padding: PAD, duration: 0 });
      m.once("resize", () => m.fitBounds(b, { padding: PAD, duration: 0 }));
      setTimeout(() => m.fitBounds(b, { padding: PAD, duration: 500 }), 300);

      // route paint-on animation (~1.2s)
      const total = coords.length;
      const t0 = performance.now();
      const dur = 1200;
      const paint = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const n = Math.max(2, Math.floor(total * p));
        const c0 = leg0Coords.slice(0, Math.min(n, leg0Coords.length));
        const c1 = leg1Coords.length
          ? leg1Coords.slice(0, Math.max(0, n - leg0Coords.length))
          : [];
        src.setData({
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: { leg: 0 },
              geometry: { type: "LineString", coordinates: c0 } },
            ...(c1.length > 1 ? [{
              type: "Feature", properties: { leg: 1 },
              geometry: { type: "LineString", coordinates: c1 },
            }] : []),
          ],
        });
        if (p < 1) requestAnimationFrame(paint);
      };
      requestAnimationFrame(paint);

      // stop markers (stagger pop) — skip stops that sit on top of an
      // already-rendered stop (pre_trip on start, post_trip on dropoff).
      const seen = [];
      const NEAR_KM = 1.5;
      const tooClose = (lat, lng) => seen.some(([a, b]) =>
        Math.hypot((a - lat) * 111, (b - lng) * 111 * Math.cos(a * Math.PI / 180)) < NEAR_KM);
      let vis = 0;
      stops.forEach((s) => {
        if (s.lat == null || tooClose(s.lat, s.lng)) return;
        seen.push([s.lat, s.lng]);
        const i = vis++;
        const meta = STOP_KIND_META[s.type] || STOP_KIND_META.start;
        const node = document.createElement("div");
        node.className = "stop-marker";
        node.style.cssText = "opacity:0;transition:opacity .25s";
        node.innerHTML = GLYPHS[meta.glyph] || GLYPHS.diamond;
        node.setAttribute("role", "button");
        node.setAttribute("aria-label", `${meta.label} ${s.city || ""}`);
        const halo = document.createElement("div");
        halo.className = "halo";
        halo.style.cssText =
          "position:absolute;inset:-9px;border:2px solid #e8a317;border-radius:50%;pointer-events:none";
        node.appendChild(halo);
        node.addEventListener("mouseenter", () => {
          onStopHover?.(s.id);
          showTip(s, meta);
        });
        node.addEventListener("mouseleave", () => {
          onStopHover?.(null);
          hideTip();
        });
        node.addEventListener("click", () => {
          onStopClick?.(s);
          pulse(node);
        });
        const mk = new maplibregl.Marker({ element: node, anchor: "center" })
          .setLngLat([s.lng, s.lat])
          .addTo(m);
        markers.current.set(s.id, mk);
        setTimeout(() => { node.style.opacity = "1"; }, 500 + i * 45);
      });

      function showTip(s, meta) {
        hideTip();
        const t = document.createElement("div");
        t.className = "stop-tip";
        const dur = s.duration_min ? ` · ${Math.floor(s.duration_min / 60)}:${String(s.duration_min % 60).padStart(2, "0")}` : "";
        t.innerHTML = `<div class="tt">${meta.label}</div>${s.city || ""}${s.state ? ", " + s.state : ""} · ${fmtStopTime(s.start_iso)}${dur}`;
        node_ref(s.id)?.appendChild(t);
        tip.current = t;
      }
      function node_ref(id) {
        return markers.current.get(id)?.getElement();
      }
      function hideTip() { tip.current?.remove(); tip.current = null; }
      function pulse(node) {
        node.animate(
          [{ boxShadow: "0 0 0 0 rgba(232,163,23,.6)" },
           { boxShadow: "0 0 0 14px rgba(232,163,23,0)" }],
          { duration: 700, easing: "ease-out" }
        );
      }
      } catch (e) { console.error("routemap apply failed", e); }
    };

    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
  }, [route, stops, revealKey, onStopHover, onStopClick]);

  /* ------- lit stop (from log hover) ------- */
  useEffect(() => {
    markers.current.forEach((mk, id) => {
      mk.getElement().classList.toggle("lit", id === litStop);
    });
  }, [litStop]);

  /* ------- replay truck ------- */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!truckPos) {
      truck.current?.remove();
      truck.current = null;
      return;
    }
    if (!truck.current) {
      const node = document.createElement("div");
      node.innerHTML = GLYPHS.truck;
      node.style.cssText = "filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))";
      truck.current = new maplibregl.Marker({ element: node, anchor: "center" })
        .setLngLat(truckPos)
        .addTo(m);
    } else {
      truck.current.setLngLat(truckPos);
    }
  }, [truckPos]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
