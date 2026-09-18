# HOS Desk

**Live: https://hosdesk.karmx.dev**

A night-dispatch trip planner that turns a truck driver's leg into a **legal
FMCSA-style paper daily log**. Enter the truck's current location, the pickup,
the dropoff, and how much of the 70-hour/8-day cycle is already burned — the
app geocodes the points, routes the truck, inserts every regulatory stop a
property-carrying driver needs, and draws one recognizable paper log sheet per
calendar day.

This is a take-home prototype, **not a certified ELD**. It renders familiar
Records of Duty Status paper logs (the JJ Keller / Schneider style) for
planning and explanation.

## What it does

- **Geocoding + routing** — Nominatim for the one forward lookup per place on
  submit and for reverse lookups (Photon fallback), Photon for search-as-you-
  type (Nominatim's policy forbids autocomplete), a cross-worker rate limit,
  and OSRM driving directions for `current → pickup → dropoff`. A driver who
  is already at the pickup gets no deadhead leg.
- **HOS planner** — a pure-Python engine that enforces:
  - 11-hour driving limit within a shift
  - 14-hour elapsed driving window
  - 30-minute break after 8 hours of driving — any 30 consecutive
    non-driving minutes count (a 1-hour pickup or a 30-minute fuel stop)
  - 70-hour/8-day cycle limit, with a 34-hour restart when the cycle is spent
  - Fuel stop every 1,000 route miles (30 min ON duty)
  - Pickup & dropoff: 1 hour ON duty each
  - Pre-trip & post-trip inspections: 15 min ON duty each
  - Daily rest: 30 minutes OFF then sleeper berth for the remainder
  - All status changes quantize to 15-minute increments
- **The paper log** — an SVG recreation of the daily log form: four duty rows,
  hour grid at 15-minute resolution, one continuous black-ink step line with
  red vertex dots, U-shaped brackets under stationary ON periods, diagonal
  remarks (city, state + activity), header fields, shipping block, miles, four
  line totals plus the `24:00` day total, a 70h/60h recap table (A = last 7
  days, B = 70 − A, C = last 8 days; the supplied blank misprints two of the
  day counts), driver signature and co-driver lines, and the
  circled on-duty decimal — all drawn in a hand-written style and animated as
  if being penned.
- **The desk** — a dark dispatch UI styled on Spotter's system (teal /
  turquoise, coral, DM Sans): itinerary form with autocomplete, a cycle-hours
  tank, HOS clocks at drop (11h / 14h / 70h), a night map with round stop
  badges (pickup green, delivery coral), a trip-progress strip, day tabs, a
  per-day stop list linked to the map and grid, and a replay that re-pens the
  day's line on the same clock that moves the truck. On phones the sheet can
  be zoomed to a readable width and panned.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health/` | Liveness |
| `GET` | `/api/geocode/?q=` | Typeahead suggestions |
| `POST` | `/api/trips/` | Plan a trip; returns route, stops, gauges, per-day logs |
| `GET` | `/api/trips/<uuid>/` | Fetch a saved trip (shareable URL) |

`POST /api/trips/` body:

```json
{
  "current_location": "Green Bay, WI",
  "pickup_location": "Chicago, IL",
  "dropoff_location": "Dallas, TX",
  "current_cycle_used_hours": 20,
  "start_time": "06:00",
  "timezone": "America/Chicago",
  "carrier": "...", "shipper": "...", "commodity": "...",
  "manifest": "...", "tractor": "...", "trailer": "...",
  "driver": "...", "home_terminal": "...", "main_office": "..."
}
```

Every optional text field defaults to `N/A`.

## Run locally

```bash
# backend  (Python 3.12+)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver        # http://127.0.0.1:8000

# frontend (Node 20+)
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

The frontend talks to `VITE_API_URL` (defaults to `http://127.0.0.1:8000`).

## Tests

```bash
cd backend && source .venv/bin/activate
python manage.py test trips
```

11 tests cover the 11h/14h/30-min/70h/34h/fuel rules, multi-day splits,
per-day totals, and a golden Schneider-style fixture.

## Configuration

Backend environment variables:

| Var | Default | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | dev value | set in production |
| `DJANGO_DEBUG` | `True` | `False` in production |
| `DJANGO_ALLOWED_HOSTS` | `*` | comma-separated |
| `DATABASE_URL` | sqlite | Postgres via `dj-database-url` |
| `CORS_ALLOWED_ORIGINS` | localhost:5173 | comma-separated |
| `NOMINATIM_URL` | public Nominatim | point at a private instance for production |
| `OSRM_URL` | public OSRM demo | likewise |
| `GEO_USER_AGENT` | `HOSDesk/1.1 …` | required by Nominatim policy |
| `GEO_REFERER` | `https://trucklog.local/` | same |

Frontend environment variables:

| Var | Default |
|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` |

## Deploy

- **Render** — `render.yaml` ships a web service: `gunicorn config.wsgi` with
  WhiteNoise serving static files; env vars wired for `DATABASE_URL` +
  `CORS_ALLOWED_ORIGINS`.
- **Docker** — root `Dockerfile` builds the Vite bundle and serves the whole
  app (API + static frontend) from one Gunicorn container.
- **Vercel** — the `frontend/` is a plain Vite app; point `VITE_API_URL` at the
  hosted API. `vercel.json` rewrites `/trips/*` to `index.html` for share
  links.

## Modeling assumptions (worth knowing)

- **Prior cycle hours are a lump.** The input is one number, not a per-day
  history, so the planner treats it conservatively: those hours never "age
  off" during the generated trip. A 34-hour restart is only inserted when the
  cycle is actually exhausted. Hours used are rounded *up* to the next 15
  minutes, so 70 real hours are never exceeded.
- **Home-terminal time.** Every sheet uses the driver's home-terminal time
  zone (default `America/Chicago`), matching the paper form's instruction.
- **15-minute ink.** All status changes snap to the quarter-hour, like pen on
  paper.
- **Property-carrying rules only** — 70h/8d, no split sleeper berth (v1).
- Stops get their city/state from reverse geocoding; if a provider can't name
  a stop the sheet still renders (label falls back).

## Project layout

```
backend/           Django 5 API
  trips/
    planner/       pure-Python HOS engine (core) + day splitter (days)
    services/      geocode (Nominatim→Photon) + OSRM routing
    tests/         planner rule tests
frontend/          React 19 + Vite + MapLibre
  src/components/  DispatchTicket, Gauges, RouteMap, LogBook, LogSheet (SVG)
```

Generated with [Devin](https://devin.ai).
