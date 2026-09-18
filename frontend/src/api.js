// Same-origin in production (Django serves the SPA). For a split
// deployment, set VITE_API_URL to the API origin. In dev, vite proxies /api.
const API_BASE = import.meta.env.VITE_API_URL || "";

export async function planTrip(input) {
  const r = await fetch(`${API_BASE}/api/trips/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || "Route service is down");
    err.field = data.field;
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function fetchTrip(id) {
  const r = await fetch(`${API_BASE}/api/trips/${id}/`);
  if (!r.ok) throw new Error("Trip not found");
  return r.json();
}

export async function geocodeSearch(q, signal) {
  const r = await fetch(
    `${API_BASE}/api/geocode/?q=${encodeURIComponent(q)}`,
    { signal }
  );
  // a failed search must not look like "no matches" (or an endless spinner)
  if (!r.ok) throw new Error("Place search is unavailable");
  return r.json();
}
