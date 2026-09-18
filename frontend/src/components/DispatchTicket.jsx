import { useEffect, useRef, useState } from "react";
import { geocodeSearch } from "../api.js";

const TZONES = [
  ["America/Chicago", "Central"],
  ["America/New_York", "Eastern"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
];

function GeoField({ label, node, value, onChange, onTyping, error, geoKey, autoFocus }) {
  const [items, setItems] = useState(null); // null=closed, []=loading
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const abort = useRef(null);
  const deb = useRef(0);

  useEffect(() => {
    const close = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const search = (q) => {
    clearTimeout(deb.current);
    if (q.trim().length < 3) { setItems(null); return; }
    setItems([]);
    deb.current = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const r = await geocodeSearch(q, ac.signal);
        setItems(r.results || []);
      } catch {
        if (!ac.signal.aborted) setItems([]);
      }
    }, 240);
  };

  const pick = (item) => {
    const short = item.city
      ? `${item.city}${item.state ? ", " + item.state : ""}`
      : item.label.split(",").slice(0, 2).join(",");
    onChange(short);
    setItems(null);
    setOpen(false);
  };

  return (
    <div className={`geo-field ${error ? "error" : ""}`} ref={box}>
      <span className={`geo-node ${node} ${items !== null ? "pulse" : ""}`} />
      <label htmlFor={geoKey}>{label}</label>
      <input
        id={geoKey}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder="City, ST"
        aria-expanded={open && items !== null}
        aria-autocomplete="list"
        role="combobox"
        onChange={(e) => {
          onChange(e.target.value);
          onTyping?.();
          setOpen(true);
          setActive(-1);
          search(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && items?.length) {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp" && items?.length) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && active >= 0 && items?.[active]) {
            e.preventDefault();
            e.stopPropagation();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setItems(null);
            setOpen(false);
          }
        }}
        onFocus={() => { if (value.trim().length >= 3) { setOpen(true); search(value); } }}
      />
      {error && <div className="field-error">{error}</div>}
      {open && items !== null && (
        <div className="ac-list" role="listbox">
          {items.length === 0 && (
            <div className="ac-skel" aria-hidden="true">
              <div /><div /><div />
            </div>
          )}
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`ac-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(it)}
            >
              <span className="ac-main">{it.label}</span>
              <span className="ac-state">{it.state || ""}</span>
            </button>
          ))}
          {items.length > 0 && items.every((it) => !it.city) && (
            <div className="ac-item" style={{ cursor: "default", opacity: 0.6 }}>
              No city match — try City, ST
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CycleTank({ value, onChange }) {
  const ref = useRef(null);
  const set = (e) => {
    const r = ref.current.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onChange(Math.round(p * 70 * 4) / 4);
  };
  const drag = (e) => {
    set(e);
    const mv = (ev) => set(ev);
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="cycle-block">
      <div className="cycle-label">
        <span>Cycle already used</span>
        <span className="val">{(70 - value).toFixed(1)} h remaining this cycle</span>
      </div>
      <div
        className="cycle-tank"
        ref={ref}
        onPointerDown={drag}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={70}
        aria-valuenow={value}
        aria-label="Cycle hours already used"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onChange(Math.max(0, value - 0.25));
          if (e.key === "ArrowRight") onChange(Math.min(70, value + 0.25));
        }}
      >
        <div className="cycle-fill" style={{ width: `${(value / 70) * 100}%` }} />
        <div className="cycle-ticks" />
      </div>
      <input
        className="cycle-num"
        type="number"
        min="0"
        max="70"
        step="0.25"
        value={value}
        onChange={(e) =>
          onChange(Math.min(70, Math.max(0, parseFloat(e.target.value) || 0)))
        }
        aria-label="Cycle hours used (numeric)"
      />
    </div>
  );
}

export default function DispatchTicket({
  phase, values, setValues, errors, setErrors, onSubmit, onSample,
  planning, planStep, toast, onRetry,
}) {
  const v = values;
  const set = (k) => (val) => setValues((s) => ({ ...s, [k]: val }));
  const clearErr = (k) => () => setErrors((e) => ({ ...e, [k]: undefined }));

  return (
    <div className="ticket-wrap">
      <form
        className="ticket"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="ticket-head">
          <div className="wordmark">
            HOS Desk<span className="pip" />
          </div>
          <div className="cycle-chip">70H / 8D · PROPERTY</div>
        </div>

        <div className="ticket-body">
          <div className="spine">
            <GeoField geoKey="f-current" label="Current" node="diamond"
              value={v.current} onChange={set("current")}
              onTyping={clearErr("current_location")}
              error={errors.current_location}
              autoFocus={phase !== "results"} />
            <GeoField geoKey="f-pickup" label="Pickup" node="square"
              value={v.pickup} onChange={set("pickup")}
              onTyping={clearErr("pickup_location")}
              error={errors.pickup_location} />
            <GeoField geoKey="f-dropoff" label="Dropoff" node="square drop"
              value={v.dropoff} onChange={set("dropoff")}
              onTyping={clearErr("dropoff_location")}
              error={errors.dropoff_location} />
          </div>

          <CycleTank value={v.cycle} onChange={set("cycle")} />

          <div className="ticket-actions">
            <button className={`cta ${phase === "results" ? "done" : ""}`}
              type="submit" disabled={planning}>
              <span className="cta-ico">
                {phase === "results" ? "✓" : "→"}
              </span>
              {planning ? "Plotting HOS…" : "Draw the logs"}
            </button>
            <button className="btn-text" type="button" onClick={onSample}
              disabled={planning}>
              Load sample
            </button>
          </div>

          {planning && (
            <div className="planning-steps" aria-live="polite">
              {["Geocoding", "Routing", "Drawing logs"].map((s, i) => (
                <span key={s}
                  className={`st ${planStep === i ? "on" : planStep > i ? "done" : ""}`}>
                  {s}
                </span>
              ))}
            </div>
          )}

          {toast && (
            <div className="ticket-toast" role="alert">
              {toast}
              {onRetry && (
                <button type="button" className="btn-text" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}

          <details>
            <summary>optional · start 06:00 · Chicago TZ · carrier / load</summary>
            <div className="opt-grid">
              <div>
                <label htmlFor="o-start">Start time</label>
                <input id="o-start" value={v.startTime}
                  onChange={(e) => set("startTime")(e.target.value)}
                  placeholder="06:00" />
              </div>
              <div>
                <label htmlFor="o-tz">Home terminal TZ</label>
                <select id="o-tz" value={v.tz}
                  onChange={(e) => set("tz")(e.target.value)}>
                  {TZONES.map(([z, n]) => (
                    <option key={z} value={z}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="span2">
                <label htmlFor="o-carrier">Carrier</label>
                <input id="o-carrier" value={v.carrier}
                  onChange={(e) => set("carrier")(e.target.value)}
                  placeholder="Demo Carrier" />
              </div>
              <div>
                <label htmlFor="o-tractor">Tractor</label>
                <input id="o-tractor" value={v.tractor}
                  onChange={(e) => set("tractor")(e.target.value)}
                  placeholder="N/A" />
              </div>
              <div>
                <label htmlFor="o-trailer">Trailer</label>
                <input id="o-trailer" value={v.trailer}
                  onChange={(e) => set("trailer")(e.target.value)}
                  placeholder="N/A" />
              </div>
              <div>
                <label htmlFor="o-shipper">Shipper</label>
                <input id="o-shipper" value={v.shipper}
                  onChange={(e) => set("shipper")(e.target.value)}
                  placeholder="N/A" />
              </div>
              <div>
                <label htmlFor="o-commodity">Commodity</label>
                <input id="o-commodity" value={v.commodity}
                  onChange={(e) => set("commodity")(e.target.value)}
                  placeholder="N/A" />
              </div>
            </div>
          </details>
        </div>
      </form>
    </div>
  );
}
