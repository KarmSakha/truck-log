import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { fmtDur, fmtTripTime, STOP_KIND_META } from "../format.js";
import { GLYPHS, stopGlyph } from "../glyphs.js";

const DARK_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const PAD = { top: 70, bottom: 70, left: 70, right: 70 };

export default function RouteMap({
  route, stops, litStop, onStopHover, onStopClick,
  truckPos, revealKey, focus,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  const truck = useRef(null);
  const tip = useRef(null);
  const bounds = useRef(null);

  const fitRoute = (duration = 500) => {
    if (map.current && bounds.current) {
      map.current.fitBounds(bounds.current, { padding: PAD, duration });
    }
  };

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
        paint: { "line-color": "#40e0d0", "line-width": 3.6, "line-opacity": 0.95 },
        layout: { "line-cap": "round" },
      });
    });
    map.current = m;

    // MapLibre ignores the first container resize it observes, and the pane
    // shrinks from full-bleed to split view right as a trip loads — so the
    // canvas could stay full-window size with the route hidden behind the
    // log pane. Track the container ourselves and re-fit the route.
    const ro = new ResizeObserver(() => {
      const c = el.current;
      const cv = m.getCanvas();
      if (!c) return;
      if (Math.abs(cv.clientWidth - c.clientWidth) > 1
          || Math.abs(cv.clientHeight - c.clientHeight) > 1) {
        m.resize();
        if (bounds.current) m.fitBounds(bounds.current, { padding: PAD, duration: 0 });
      }
    });
    ro.observe(el.current);

    // When map and log stack into one scrolling page, a plain wheel or
    // one-finger drag should scroll the page, not zoom/pan the map (⌘/Ctrl +
    // scroll or two fingers still work). Side by side, the map keeps them.
    const stacked = window.matchMedia("(max-width: 720px)");
    const syncGestures = () => {
      if (stacked.matches) m.cooperativeGestures.enable();
      else m.cooperativeGestures.disable();
    };
    syncGestures();
    stacked.addEventListener("change", syncGestures);

    return () => {
      stacked.removeEventListener("change", syncGestures);
      ro.disconnect();
      m.remove();
      map.current = null;
    };
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

      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      bounds.current = b;
      m.resize();
      m.fitBounds(b, { padding: PAD, duration: 0 });
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
        node.innerHTML = stopGlyph(s.type);
        node.tabIndex = 0;
        node.setAttribute("role", "button");
        node.setAttribute("aria-label",
          `${meta.label}, ${[s.city, s.state].filter(Boolean).join(", ")}, ${fmtTripTime(s.start_min)}`);
        const halo = document.createElement("div");
        halo.className = "halo";
        halo.style.cssText =
          "position:absolute;inset:-8px;border:2px solid #40e0d0;border-radius:50%;pointer-events:none";
        node.appendChild(halo);
        const enter = () => { onStopHover?.(s.id); showTip(s, meta); };
        const leave = () => { onStopHover?.(null); hideTip(); };
        node.addEventListener("mouseenter", enter);
        node.addEventListener("mouseleave", leave);
        node.addEventListener("focus", enter);
        node.addEventListener("blur", leave);
        node.addEventListener("click", () => {
          onStopClick?.(s);
          pulse(node);
        });
        node.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onStopClick?.(s);
            pulse(node);
          }
        });
        const mk = new maplibregl.Marker({ element: node, anchor: "center" })
          .setLngLat([s.lng, s.lat])
          .addTo(m);
        markers.current.set(s.id, mk);
        setTimeout(() => { node.style.opacity = "1"; }, 500 + i * 45);
      });

      function showTip(s, meta) {
        hideTip();
        // built with textContent: place names come from the geocoder
        const t = document.createElement("div");
        t.className = "stop-tip";
        t.style.borderLeftColor = meta.fill;
        const head = document.createElement("div");
        head.className = "tt";
        head.style.color = meta.tone;
        head.textContent = meta.label;
        const place = [s.city, s.state].filter(Boolean).join(", ");
        const dur = s.duration_min ? ` · ${fmtDur(s.duration_min)}` : "";
        t.append(head, `${place} · ${fmtTripTime(s.start_min)}${dur}`);
        markers.current.get(s.id)?.getElement().appendChild(t);
        tip.current = t;
      }
      function hideTip() { tip.current?.remove(); tip.current = null; }
      function pulse(node) {
        node.animate(
          [{ boxShadow: "0 0 0 0 rgba(64,224,208,.6)" },
           { boxShadow: "0 0 0 14px rgba(64,224,208,0)" }],
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

  /* ------- centre on a stop picked from the itinerary ------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !focus || focus.lat == null) return;
    m.easeTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(m.getZoom(), 6.5),
      duration: 700,
    });
  }, [focus]);

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

  return (
    <>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {route && (
        <button type="button" className="map-fit" onClick={() => fitRoute()}
          title="Fit the whole route" aria-label="Fit the whole route in view">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" fill="none"
              stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
    </>
  );
}
