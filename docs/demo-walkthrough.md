# Submission recording — approximately 4 minutes

Live app: https://hosdesk.karmx.dev
Repository: https://github.com/KarmSakha/truck-log

Record this walkthrough in Loom and include the recording URL with the two links above.

## 0:00–0:40 — Plan a trip

Show the four required inputs: current location, pickup, dropoff, and cycle hours already used.
Choose Try a sample trip. Explain that the Django API geocodes the locations, obtains a route,
and applies the HOS planner. Point out route mileage, arrival time and the clocks at finish.

## 0:40–1:30 — Map and daily logs

Select a rest or fuel stop to connect its position on the map with the itinerary.
Switch between days. Show the four duty statuses, remarks, quarter-hour grid,
and totals adding to 24 hours. Zoom the sheet to read the details; expand the log pane on desktop.
Show the road-by-road directions and planning assumptions below the sheet.

## 1:30–2:00 — Interactions

Replay a day, pause, seek, and resume. Copy the saved trip link and reload it to demonstrate
restoration. Show the print preview with all sheets. Briefly show the mobile layout.

## 2:00–3:10 — Backend

Open backend/trips/views.py to show validation and orchestration.
Open backend/trips/planner/core.py: explain the 11-hour driving limit, 14-hour window,
30-minute interruption after 8 hours driving, 10-hour rest, 70-hour cycle, and 34-hour restart.
Explain that non-driving work may continue after cycle exhaustion, but further driving cannot.
Point to one-hour pickup/unloading and fueling before exceeding 1,000 miles.
Open backend/trips/planner/days.py to show midnight splitting and daily totals.

## 3:10–3:45 — Frontend and verification

Open frontend/src/components/LogSheet.jsx for SVG rendering, brackets and remarks.
Open LogBook.jsx for accessible day navigation, zoom and print handling.
Show passing backend tests and frontend tests/lint. Mention the regression for unloading near
the cycle limit and the fixture matching the reference video's duty totals.

## 3:45–4:10 — Assumptions and close

Explain that this is a trip-planning prototype: the driver starts rested, prior cycle hours
are treated conservatively without per-day history, and routes use a general driving profile.
Fuel and rest markers are estimated positions, not verified facilities.
Close on the live application and show the repository URL.
