# Product Requirements Document

**Product:** Trip Planner + Hours of Service Daily Logs  
**Working title:** Truck Log  
**Document type:** Implementation PRD (take-home assessment)  
**Version:** 1.3  
**Date:** 2026-09-18  
**Status:** Ready for build  
**UX bar:** Extraordinary — the brief says good aesthetics can offset some output inaccuracy; this product must not look like a generic form + map demo.  
**Log drawing:** `blank-paper-log.png` (layout) + `refs/youtube/` (ink) + `youtube trasncript.txt` (spoken procedure).  
**Stack constraint:** Django backend + React frontend  
**Primary user:** Property-carrying CMV driver planning a trip and generating FMCSA-style daily logs

---

## 1. Purpose

Build a hosted full-stack app that takes a driver’s current location, pickup, dropoff, and hours already used in the current 70-hour/8-day cycle, then:

1. Plans a legal route with required stops and rest.
2. Shows that route on a map, with stop/rest information.
3. Draws filled **Driver’s Daily Log** sheets (one calendar day per sheet, multiple sheets for longer trips).

This is a **trip planner that renders paper-style Records of Duty Status (RODS)**. It is not a certified Electronic Logging Device. The assessment asks for “ELD logs” as the output, meaning the familiar 24-hour graph-grid daily log, not an FMCSA-registered ELD connected to a vehicle ECM.

Accuracy of HOS math and log drawing will be tested. Visual quality can offset some output inaccuracy, but the logs must still look like real daily logs and add up correctly.

---

## 2. Source materials

This PRD is the synthesis of the files in this folder plus the assigned walkthrough video.

| Source | Role in the product |
| --- | --- |
| `new-full-stack-dev-assessment.docx` (Spotter) | Assignment: inputs, outputs, stack, assumptions, deliverables, accuracy + UX bar |
| `fmcsa-hos-395-drivers-guide-to-hos-2022-04-28-0-1-.pdf` | Hours of Service rules, RODS fields, graph grid, remarks, recap logic |
| `fmsca-image.png` | Highlighted table of contents: on/off duty, 14/11/sleeper/30-min/70-8, daily log, remarks, completed grid |
| `blank-paper-log.png` | Canonical **form layout** (header, grid, recap) for generated sheets |
| [How to fill out a log book](https://www.youtube.com/watch?v=whxe41XYXS8) | Schneider instructor Henry, ~6:46 |
| `youtube trasncript.txt` | **Spoken source of truth** for fill order, remarks vocabulary, brackets, dots, 10.5 circle |
| `refs/youtube/` (20 frames) | **Ink source of truth**: step-line, red vertices, U-brackets, diagonal remarks, HH/MM totals |

Regulatory text in this PRD is a product spec, not legal advice. HOS rules implemented here follow FMCSA’s April 2022 *Interstate Truck Driver’s Guide to Hours of Service* for **property-carrying** drivers.

---

## 3. Problem

Property-carrying drivers must stay inside federal Hours of Service limits and keep a Record of Duty Status for every 24-hour period. Planning a trip by hand means:

- Geocoding three points and getting a driveable route.
- Inserting pickup, dropoff, fuel, 30-minute break, and 10-hour rest at the right clock times.
- Splitting the resulting timeline across midnight into multiple paper log grids.
- Filling remarks, miles, recap math, and line totals so each page equals 24 hours.

Doing that incorrectly is a compliance and safety failure. The product automates the plan and draws the logs the driver (or a reviewer) would otherwise complete by hand.

---

## 4. Goals and non-goals

### 4.1 Goals

| ID | Goal | How we know |
| --- | --- | --- |
| G1 | A user can enter four inputs and get a route + stops without leaving the app | Happy-path trip completes in one submit |
| G2 | The route respects the assessment HOS profile | No planned **driving** after 11 hours driving, after the 14-hour window, or after 70 hours in 8 days |
| G3 | Daily logs look like the blank paper form and are filled, not blank templates | Side-by-side with `blank-paper-log.png` |
| G4 | Long trips produce **multiple** log sheets, one per calendar day touched | A 2,000-mile trip yields more than one page |
| G5 | UI feels like a dispatch tool, not a student form: night-ops chrome, paper-log theater, map/log playback | 10-second first impression + Loom |
| G6 | App is publicly reachable, source is on GitHub | Live URL + repo |

### 4.2 Non-goals (v1)

- FMCSA-certified ELD, engine connection, automatic driving detection, or output-file transfer to enforcement.
- Login, fleet admin, multi-driver accounts, or co-driver / team operations.
- Adverse driving conditions (+2 hours), short-haul exceptions, passenger-carrying HOS, personal conveyance, yard moves.
- Editing an already-generated log by dragging grid lines (read-only generated sheets).
- Turn-by-turn voice navigation or live GPS tracking.
- 60-hour/7-day cycle (assessment locks 70/8).
- Split sleeper-berth provision (7/3 or 7/2 pairing). v1 uses a single **10 consecutive hours** off-duty / sleeper restart of the 11- and 14-hour clocks.

---

## 5. Users and context

### Primary — Driver (assessment persona)

Solo property-carrying driver, 70-hour/8-day cycle, planning current → pickup → dropoff. Needs to see whether the trip fits remaining cycle hours and what the daily logs will look like.

### Secondary — Reviewer (Spotter / interviewer)

Opens the hosted app, enters a sample trip, checks map stops, and inspects drawn logs for HOS correctness and visual fidelity. Also watches a 3–5 minute Loom of the app and code.

There is no authenticated multi-user product in v1. Treat each submit as a stateless plan, optionally persisted so a trip URL can be shared.

---

## 6. Assignment requirements (must match the brief)

### Inputs

| Field | Meaning |
| --- | --- |
| Current location | Where the truck is now (address or city) |
| Pickup location | Where the load is picked up |
| Dropoff location | Where the load is delivered |
| Current Cycle Used (Hrs) | On-duty hours already accumulated in the current rolling 8-day / 70-hour cycle, **before this trip starts** |

Locations must be geocodable. Cycle used must be a number from **0 through 70**.

### Outputs

1. **Map** of the route with information about stops and rests. Use a **free** map / routing API.
2. **Daily log sheets**, drawn and filled. Longer trips need **multiple sheets**.

### Locked assumptions

- Property-carrying driver.
- **70 hours / 8 days**.
- **No** adverse driving conditions.
- **Fuel at least once every 1,000 miles**.
- **1 hour** on-duty not driving for pickup, and **1 hour** on-duty not driving for dropoff.

### Deliverables

- Live hosted app (Vercel for the frontend is acceptable; Django API must also be publicly reachable).
- 3–5 minute Loom walking through the app and the code.
- GitHub repository.
- Accuracy is tested and must be up to standard.
- UI/UX must be good; design quality can compensate for some output inaccuracy.

---

## 7. Hours of Service rules the engine must enforce

All times are in **15-minute increments** (paper grid resolution from the Schneider walkthrough and the blank form).

### 7.1 Duty statuses (four grid lines)

| Line | Status | Code | What it means |
| --- | --- | --- | --- |
| 1 | Off Duty | OFF | Not driving and not performing job-related work. Must be relieved of duty. Includes the 30-minute break when logged off duty. |
| 2 | Sleeper Berth | SB | Rest **in the sleeper berth** (a location, not an activity). Used for the 10-hour daily rest after a short off-duty wrap-up (pre/post-trip). |
| 3 | Driving | D | At the controls of a CMV in operation. |
| 4 | On Duty (not driving) | ON | Non-driving work: pre-trip, TI, fuel, scaling, loading/unloading, post-trip, paperwork. |

Exactly one status is active at any instant. The four line totals on a calendar day **must equal 24:00**.

### 7.2 Daily limits (property-carrying)

| Rule | Limit | Product behavior |
| --- | --- | --- |
| 10-hour restart | ≥ 10 consecutive hours OFF and/or SB | After this, 11-hour and 14-hour clocks reset |
| 14-hour driving window | Starts at the first ON or D after a 10-hour restart | **No driving** after hour 14, even if driving hours remain. Non-driving ON work after hour 14 is allowed but still counts toward 70 hours |
| 11-hour driving limit | ≤ 11 hours D inside the 14-hour window | Stop driving and take a 10-hour restart |
| 30-minute break | After **8 cumulative** driving hours | ≥ 30 consecutive minutes **not driving** (OFF, SB, and/or ON). Does not extend 11 or 14. Assessment trips should insert a dedicated 30-minute OFF break unless a qualifying ON stop (fuel/pickup) already covers it |
| 70-hour / 8-day | Cannot **drive** after 70 on-duty hours (D + ON) in any rolling 8 consecutive days | `remaining_cycle = 70 − current_cycle_used`. Planned D+ON on this trip cannot exceed remaining. If the trip cannot finish, insert a **34-hour restart** (OFF/SB) to reset the 70-hour clock to 0, then continue |

### 7.3 What counts as on-duty (for cycle and recap)

Include: pre/post-trip, fuel, loading/unloading, driving, waiting to be dispatched if not relieved, paperwork, breakdown work.

Exclude: OFF, SB.

Pickup and dropoff are **ON, 1:00 each**, per the brief.

### 7.4 Fuel

Insert an ON fuel stop of **30 minutes** before driving distance since the last fuel (or trip start) would exceed **1,000 miles**. Prefer a point on the planned route near that mileage. If routing cannot snap to a station, still insert a 30-minute ON stop on the polyline and remark it as fuel.

### 7.5 34-hour restart (only when needed)

Optional in the FMCSRs; **required in this product** when remaining 70-hour capacity cannot cover the rest of the trip. After ≥ 34 consecutive hours OFF/SB, cycle used becomes 0 and the 8-day window starts over.

### 7.6 Out of v1 HOS

Do not apply: +2 adverse, short-haul 150 air-mile, 16-hour exception, split sleeper pairing, personal conveyance, yard moves, team passenger-seat 7+3.

---

## 8. Trip planner behavior

### 8.1 Route

1. Geocode current, pickup, dropoff.
2. Request a driving route **current → pickup → dropoff** (two legs, one polyline).
3. Use returned distance and duration. Derive average speed per leg from the API; do not assume a flat 55 mph if the API gives duration.
4. Convert driving time to 15-minute grid steps (round to nearest 15 minutes; never round a non-zero drive down to zero).

### 8.2 Default day clock

- Home-terminal timezone: **America/Chicago** unless the user picks another US zone. The 24-hour grid is midnight-to-midnight in that zone, matching “use the time standard of home terminal” on the paper form.
- First work of the trip starts at **06:00** terminal time, matching both the Schneider sample (06:30) and the FMCSA sample (06:00). If 06:00 would violate remaining 10-hour rest from an unknown previous day, still start at 06:00 — previous-day rest is assumed complete.

### 8.3 Event sequence (happy path)

Times are illustrative; the engine must compute from route duration and remaining HOS.

| Order | Event | Status | Duration | Remarks (city, ST + activity) |
| --- | --- | --- | --- | --- |
| 1 | Off duty until start | OFF | midnight → start | — |
| 2 | Pre-trip + trailer integrity (TI) at current location | ON | **15 minutes** (30 minutes if the user-facing copy wants Schneider-style inspections; default **15**) | `{current city, ST} Pre-trip / TI` |
| 3 | Drive current → pickup | D | from API | — |
| 4 | Pickup | ON | **1:00** | `{pickup city, ST} Pickup / loading` |
| 5 | Drive pickup → dropoff, interrupted by fuel and HOS | D | from API | — |
| 6 | 30-minute break when 8:00 driving accumulated in the window | OFF | **0:30** | `{nearest city, ST} 30-min break` |
| 7 | Fuel every 1,000 miles | ON | **0:30** | `{nearest city, ST} Fuel` |
| 8 | If 11:00 driving or 14:00 window hit before dropoff | OFF then SB | OFF **0:30** wrap-up + SB until **10:00** total restart (or all 10:00 OFF if no sleeper assumed — **v1 default: 10:00 SB** after a short OFF post-trip style wrap) | `{city, ST} 10-hr rest` |
| 9 | Resume driving after restart | D | remaining | — |
| 10 | Dropoff | ON | **1:00** | `{dropoff city, ST} Dropoff / unloading` |
| 11 | Post-trip + TI | ON | **15 minutes** | `{dropoff city, ST} Post-trip / TI` |
| 12 | Go off duty / sleeper for the rest of that calendar day | OFF then SB | remainder of day | `{dropoff city, ST} Off duty / sleeper` |

**Non-movement / “bracket”:** On paper, a cup-shaped bracket under ON time means the truck did not move (pre-trip, scale, fuel, loading). Draw an equivalent bracket or hatch on ON segments whose location equals the previous stop (see §10.4).

### 8.4 HOS insertion algorithm (normative)

Process the trip as a timeline of remaining driving miles.

```
remaining_cycle = 70h - current_cycle_used
window_start = first ON/D of the work shift
driving_in_window = 0
driving_since_break = 0
miles_since_fuel = 0

For each driving slice of 15 minutes (or until next planned stop):
  If miles_since_fuel + slice_miles > 1000:
      insert 0:30 ON fuel at current route position
      miles_since_fuel = 0
      continue
  If driving_since_break + slice would exceed 8:00:
      insert 0:30 OFF break (unless the next 0:30 is already a qualifying ON stop)
      driving_since_break = 0
      continue
  If driving_in_window + slice would exceed 11:00
     OR now >= window_start + 14:00:
      insert 10:00 restart (OFF/SB)
      reset 11h and 14h clocks
      continue
  If remaining_cycle - (slice as ON-duty) < 0:
      insert 34:00 restart
      remaining_cycle = 70:00
      continue
  Append D slice; increment clocks, miles, remaining_cycle
```

Pickup/dropoff/pre/post/fuel all decrement `remaining_cycle`. Rest (OFF/SB) does not.

If a 10-hour rest would cross midnight, split it across two log sheets; consecutive SB/OFF still counts as one restart if it is consecutive on the clock.

### 8.5 Stops the map must show

Each stop is a labeled marker:

- Current (start)
- Pickup
- Dropoff
- Every fuel stop
- Every 30-minute break
- Every 10-hour rest / sleeper location (end of the driving segment that triggered rest)
- 34-hour restart, if any

Each marker lists: stop type, city/state, arrival clock time, duration, duty status.

Draw the route polyline. Distinguish current→pickup (deadhead) vs pickup→dropoff (loaded) if the API allows two legs.

---

## 9. Daily log sheet — required fields

Each calendar day the timeline touches gets one sheet. Layout follows `blank-paper-log.png`. FMCSA RODS content (guide pp. 15–19) mapped onto that form:

### 9.1 Header

| Form field | Product fill rule |
| --- | --- |
| Date (month / day / year) | Calendar date of that sheet in home-terminal time |
| From / To | First and last locations on that day (city, ST) |
| Total Miles Driving Today | Sum of driving miles on that calendar day |
| Total Mileage Today | Same as driving miles in v1 (no non-driving CMV miles) |
| Truck/Tractor and Trailer Numbers or License Plate(s)/State | `N/A` unless optional vehicle fields are provided in the UI |
| Name of Carrier or Carriers | `Demo Carrier` (editable optional field) |
| Main Office Address | `N/A` or optional |
| Home Terminal Address | Optional; default empty |
| Original / Duplicate note | Print the form’s legal line: original at home terminal; duplicate in driver possession 8 days |

### 9.2 Graph grid

- 24-hour period, midnight to midnight.
- Hours printed across the top; each hour split into **four 15-minute ticks**.
- Four horizontal rows: **1 Off Duty, 2 Sleeper Berth, 3 Driving, 4 On Duty (not driving)**.
- Draw a **solid horizontal line** on the active status for each interval, with **vertical connectors** when status changes (Schneider: dot → line across → drop/rise to the next line).
- **Total Hours** column on the right: hours:minutes per line, summing to **24:00**.

### 9.3 Remarks

On **every duty-status change**, write:

- City, town, or village **and state abbreviation**.
- What the driver was doing, in the Schneider style: pre-trip, TI, fuel, scale, 30-min break, pickup, dropoff, post-trip, sleeper.

If the change is not in a city, use nearest city + ST (v1 does not require milepost/highway syntax).

Place remarks under the grid, roughly under the time of the change, as on a paper log — not a disconnected list only.

### 9.4 Shipping documents

| Field | v1 fill |
| --- | --- |
| DVL or Manifest No. | `N/A` or generated trip id |
| Shipper & Commodity | `N/A` unless optional inputs provided |

### 9.5 Recap (complete at end of day)

The blank form’s recap block, for a **70-hour/8-day** driver:

| Box | Meaning | Calculation |
| --- | --- | --- |
| On duty hours today (lines 3 + 4) | D + ON that calendar day | Sum of Driving + On Duty (not driving) |
| A. Total hours on duty last 7 days including today | Rolling 7-day ON+D including this sheet | `prior_7_including_today` |
| B. Total hours available tomorrow | 70 − A\* | If a 34-hour restart completed, B = 70 |
| C. Total hours on duty last 8 days | Rolling 8-day ON+D | Includes today |

\*If the driver took 34 consecutive hours off duty, 60/70 hours are available again.

**60-hour/7-day columns** may be rendered for form fidelity but should be blank or marked N/A — the product does not operate that cycle.

### 9.6 Circled on-duty total (Schneider)

After line totals, show **driving + on duty (not driving)** for the day as a decimal (e.g. `10.5`) and **circle it**. This is the walkthrough’s “hours of driving and how much on-duty time we have.”

---

## 10. Visual fidelity — paper log + YouTube frames

The log is the product’s signature UI. **Layout** follows `blank-paper-log.png`. **How the ink sits on that layout** follows the Schneider frames in `refs/youtube/` (not Schneider branding, not their “70 hr / 7day” CN note — this app is **70h / 8d**).

### 10.1 Canvas

Render each sheet as **SVG**, not an HTML table of hours. Grid, black polyline, remarks, shipping, recap, and totals are one form.

Primary layout: `blank-paper-log.png`.  
Primary ink reference: `refs/youtube/02-completed-graph.png`, `17-draw-full-day.png`, `08-remarks-complete.png`, `19-totals-24h.png`, `20-circled-10-5.png`.  
Primary spoken reference: `youtube trasncript.txt` (ASR typos: sleeper *birth* → berth, *code/Cod driver* → co-driver, *Fondulac* → Fond du Lac, *pawpaw* → Paw Paw, *green B* → Green Bay, *Naas* → N/A).

### 10.1a Fill order (transcript)

Henry fills the **header before the graph**, then miles, then line totals, then the circled combo:

1. Date  
2. Driver number  
3. Initials  
4. Signature  
5. Co-driver → `N/A` if none  
6. Home operating center  
7. Tractor, trailer; other trailers → `N/A`  
8. Shipper, commodity, load ID; other loads → `N/A`  
9. Graph: dot at the time → horizontal line to connect → vertical to the new status → **45° remark** (city, ST + activity) → **cup bracket** if the truck did not move  
10. Total driving miles (next to trailer number); total truck miles (= driving miles with no co-driver)  
11. Count blocks per line including half-hour blocks; four lines **must equal 24 hours**  
12. Driving + on-duty not driving as a decimal (**10.5**) and **circle it**

### 10.2 Grid anatomy (from frames)

Four labeled rows, midnight → 11, noon → 11 (24 hours). Each hour has a tall 30-min tick and shorter 15-min ticks (`01-grid-anatomy-four-lines.png`).

| Line | Status | Video overlay color (optional row wash, 8–12% opacity) | Ink |
| --- | --- | --- | --- |
| 1 | Off duty | Orange (`03-line1-off-duty.png`) | Thick black stroke on the row |
| 2 | Sleeper berth | Yellow (`04-line2-sleeper-berth.png`) | same |
| 3 | Driving | Blue (`05-line3-driving.png`) | same |
| 4 | On duty (not driving) | Green (`06-line4-on-duty.png`) | same |

The orange/yellow/blue/green bands are **teaching overlays** in the video. Use them as a subtle row tint in the app; do not replace the black graph line with colored ink.

### 10.3 Ink language (normative)

From `14-draw-start-pretrip.png` through `17-draw-full-day.png`:

1. **One continuous polyline** through the day. Horizontal on the active status; **vertical** at the change time to the new row. 90° corners only — no diagonals on the grid.
2. **Red filled dots** (~3–4px at grid scale) at every vertex (start of a run, every corner). The video uses these as “pen down” marks; keep them in the product — they make the graph readable.
3. Stroke: black, ~2.5–3.5px on a 1200px-wide sheet, round caps/joins.
4. Align every vertex to a **15-minute** tick. Never park a corner in the middle of a quarter-hour.
5. **U-brackets** hang off the bottom of the grid under time the truck did not move (pre-trip, scale/fuel, loading) **and** under the 30-min break in the sample. Shape: two short verticals + a floor, like a staple / cup (`15-draw-brackets-break.png`).
6. **Remarks** are **not** a left-aligned list. They are **diagonal labels** (~45°, Henry: “a little 45° mark”) sitting in the remarks band, tied to the bracket or a leader at the change time (`08-remarks-complete.png`, transcript § remarks). Two lines:
   - Line 1: `City, ST`
   - Line 2: **what they were doing** — transcript list: pre-trip / post-trip inspection, in-route truck inspections, loading/unloading freight, changing trailers, fueling, scale, 30-min break, 10-hour break
7. **TIV / TI** = Trailer Integrity Verification (transcript: “TI stands for trailer Integrity verification”). Labels: `Pre-trip/TIV`, `Post-trip/TIV`.
8. Empty unused fields get **`N/A`**, not blank (co-driver, extra trailers, extra loads) — transcript: “na or not applicable.”
9. **Sleeper berth is a location, not an activity.** After post-trip they stay **OFF** while wrapping up in the cab, then move to **SB** when they get in the berth (transcript: “changed the location in his truck”).
10. **Dots** at change times are how the line is constructed (“put a little dot… draw a line from the left to the right to connect the dot”). Keep the red vertices.

### 10.4 Header / miles / totals (from frames)

Fill the assignment form’s equivalent boxes. Digit style in the video is boxed 7-segment-like figures; we can use IBM Plex Mono in boxes.

| Field | Sample in video | Product rule |
| --- | --- | --- |
| Date | `04 06 24` (`18-miles-date.png`) | Calendar date of that sheet, boxed MM DD YY |
| Driver number / initials / signature | `11111111`, `YS`, script signature | Optional inputs; defaults `N/A` or demo values |
| Co-driver | `N/A` | Always `N/A` in v1 |
| Home terminal | Green Bay, WI | Use start-of-day city, ST or optional field |
| Carrier | Schneider… | **Do not copy.** Default `Demo Carrier` |
| Power / trailer | `P 48872` / `T TA939200` | Optional; else `N/A` |
| Extra trailers `T _ T _ T _` | `N/A` each | `N/A` |
| Total driving miles today | **`472`** (3 boxes) | Integer miles driven that calendar day |
| Total truck mileage today | **`0472`** (4 boxes) | Same as driving miles in v1 (solo, no co-driver) |
| Shipper / commodity / load | Don’s Paper Co. / Paper products / `ST13241564114` | Optional; else `N/A` |
| Line totals | Split **HOURS** + **MINUTES TO BE 00, 15, 30, 45** (`19-totals-24h.png`) | Four rows + fifth **24 00** |
| Circled combo | Red circle around **`10.5`** (`20-circled-10-5.png`) | (Driving + ON) as decimal, 1 step (×.25) |

**Golden totals (must match fixture):**

| Line | Hours | Minutes |
| --- | --- | --- |
| 1 OFF | 08 | 30 |
| 2 SB | 05 | 00 |
| 3 D | 09 | 30 |
| 4 ON | 01 | 00 |
| Total | 24 | 00 |

Circled: **10.5** (9.5 drive + 1.0 on-duty).

### 10.5 Golden example (video) — drawing QA only

This trip is **not** the assessment routing output. Encode it as a renderer fixture (`Load Schneider sample log`) so drawing can be judged with the frames.

| Time | Status | Remark (diagonal) | Bracket |
| --- | --- | --- | --- |
| 00:00–06:30 | OFF | — | no |
| 06:30–07:00 | ON | Green Bay, WI / Pre-trip/TIV | yes |
| 07:00–08:30 | D | — | no |
| 08:30–09:00 | ON | Fond Du Lac, WI / Scale (CAT scale; drink still ON) | yes |
| 09:00–13:00 | D | — | no |
| 13:00–13:30 | OFF | Paw Paw, IL / 30 min break | yes |
| 13:30–17:30 | D | — | no |
| 17:30–19:00 | OFF | Edwardsville, IL / Post-trip/TIV-6 min / 10 hour break | leader |
| 19:00–24:00 | SB | (same rest; no second remark required) | no |

Miles 472 / truck 0472. Date 04/06/24. Co-driver N/A.

**Replay** should look like frames 14 → 15 → 17: dots appear, then the step-line grows left to right, then remarks drop in.

### 10.6 Frame index

| File | Use when implementing |
| --- | --- |
| `refs/youtube/01-grid-anatomy-four-lines.png` | Row labels + 15-min ticks |
| `02-completed-graph.png` | Full step-line silhouette |
| `03`–`06` | Optional row tints + FMCSR one-liners in a legend, not on the legal form |
| `08-remarks-complete.png` | Remark angle, two-line copy, four stops |
| `09`–`11` | Header density, N/A, vehicle P/T |
| `13-shipping-filled.png` | Shipper / commodity / load |
| `14-draw-start-pretrip.png` | First vertical + first remark + red dots |
| `15`–`17` | Brackets, 30-min break, end-of-day rest |
| `18-miles-date.png` | 472 vs 0472 boxes, date 040624 |
| `19-totals-24h.png` | Hours/minutes matrix summing to 24:00 |
| `20-circled-10-5.png` | Red circle 10.5 placement near remarks/load |

Original screenshots remain in the folder root; `refs/youtube/` is the named set for engineering.

### 10.7 FMCSA completed-grid story (second QA fixture)

FMCSA sample (Richmond, VA → Newark, NJ): report 06:00 ON load/pre-trip, fuel Fredericksburg, lunch OFF Baltimore, delivery ON Philadelphia, sleeper Cherry Hill, off duty Newark 21:00. Totals in the guide: OFF 10, SB 1.75, Driving 7.75, ON 4.5. Shipping no. 101601.

Draw it with the **same ink language** as §10.3. Do not copy Schneider’s carrier header onto it.

---

## 11. User experience — extraordinary by design

The assessment says: *“UI and UX must be good. Pay attention to good design and aesthetics, it can compensate for some inaccuracies in output.”*

v1.0 of this PRD only specified a clean two-pane layout. That is not enough. Reviewers will open dozens of Django+React maps. This app must feel like a **night dispatch desk with a paper logbook under a lamp** — cinematic chrome, a physical daily log, and one signature interaction: **replay the day** (map truck + grid ink moving together).

Do **not** ship: Inter on white cards, purple gradients, a left sidebar, a Bootstrap table labeled “ELD Log,” or a default Leaflet map with blue pins.

### 11.1 Product feel

| Axis | Direction |
| --- | --- |
| Emotion | Competent, nocturnal, analog-meets-digital. Trust, not playfulness. |
| Metaphor | Truck cab instruments + clipboard log. The UI is the dash; the log is paper. |
| Contrast | Dark app chrome vs warm paper sheet. That contrast is the brand. |
| Motion | One staged reveal, then quiet. Ink draws once. No looping decoration. |
| Density | Dispatch-dense on the map/gauges; the log stays sparse and legal. |

Name on screen: **HOS Desk** (or **Truck Log**). Wordmark in condensed caps, small amber tick as a “hours remaining” pip.

### 11.2 Visual system

**Color (token names)**

| Token | Hex | Use |
| --- | --- | --- |
| `night-950` | `#070B14` | App background |
| `night-900` | `#0C1220` | Panels |
| `night-800` | `#151D2E` | Raised surfaces, inputs |
| `line-700` | `#2A3548` | Hairline borders |
| `fog-300` | `#C5CDD8` | Secondary text |
| `fog-100` | `#E8EDF4` | Primary text on dark |
| `amber-400` | `#E8A317` | Primary accent, driving, CTA, route |
| `amber-200` | `#F3D08A` | Hover glow, gauge fill |
| `paper` | `#F3EBDD` | Log sheet |
| `ink` | `#1C1914` | Log drawing |
| `stamp-red` | `#B42318` | Circled 10.5, original/duplicate stamp |
| Status OFF | `#8B93A1` | Grid line 1 |
| Status SB | `#6E7AA8` | Grid line 2 |
| Status D | `#E8A317` | Grid line 3 + map route (loaded) |
| Status ON | `#C45C26` | Grid line 4, fuel/pickup markers |

Deadhead (current → pickup) route: dashed `fog-300`. Loaded (pickup → dropoff): solid `amber-400`.

**Type**

- UI: [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) + **IBM Plex Sans Condensed** for labels/gauges (highway-sign energy, free).
- Log sheet numerals and remarks: **IBM Plex Mono** at 11–13px, so the grid looks filled by a person, not a website.
- Display: condensed tracking `0.08em` for “DRIVER’S DAILY LOG” on the paper, matching the blank form.

**Shape and light**

- Radius: 6px on inputs, 12px on the dispatch ticket, **2px** on the paper log (almost square — it is a form).
- No heavy drop shadows on dark UI. Use 1px `line-700` borders and a 24px inner amber glow only on the focused field and the CTA.
- Paper log: layered shadow `(0 1px 0 rgba(0,0,0,.06), 0 24px 48px rgba(0,0,0,.45))`, 0.4° rotation, faint fiber noise (`opacity: 0.04`). Clipboard clip graphic optional; do not let it hide the date fields.
- 8px / 12px / 24px / 48px spacing scale. Landing ticket max-width 420px. Results use the full viewport.

**Map**

Custom dark style (MapLibre + a free dark OSM style such as Positron dark / custom JSON). Not default OSM streets.

- Water and land near `night-950`. Roads dim. Labels muted.
- Route draws **on**, not dumped all at once: polyline animates origin → destination over ~1.2s after results arrive.
- Markers are custom SVG, not teardrop pins:

  | Stop | Glyph |
  | --- | --- |
  | Current | Hollow diamond |
  | Pickup | Square with “P” |
  | Dropoff | Square with “D” |
  | Fuel | Pump / droplet |
  | 30-min break | Crescent / pause |
  | 10-hour rest | Berth rectangle |
  | 34-hour restart | Double bar |

- Selected stop: amber ring pulse (once). Tooltip is a tiny dispatch sticker: time · duration · status color.

### 11.3 Screens and layout

**A. Landing — empty night map + dispatch ticket**

Full-viewport dark map of the US (or last-used region) as atmosphere. No marketing hero, no feature grid.

Left (or center on mobile): a **bill-of-lading / dispatch ticket** card.

```
HOS DESK                         70h / 8d
────────────────────────────────────────
  ●  Current
     [  geocode field               ]
  │
  ■  Pickup
     [  geocode field               ]
  │
  ■  Dropoff
     [  geocode field               ]
────────────────────────────────────────
  Cycle already used
  [========|--------]  20.0 h of 70
────────────────────────────────────────
  [  Draw the logs  ]    Load sample
  optional ▸ start 06:00  ·  Chicago TZ
```

- The spine (●—■—■) is the itinerary. A small truck icon sits on the current node until submit, then it will travel the map.
- Autocomplete dropdown matches the ticket: dark, 13px, distance/state on the right.
- Cycle control is a **horizontal tank**, not a naked number. Drag or type. Live label: `50.0 h remaining this cycle`.
- Primary CTA copy: **Draw the logs** (the output they will judge). Secondary text button: **Load sample** (Chicago → Dallas → Houston, 20h used).
- Optional fields behind `<details>`: start time, timezone, carrier, vehicle, shipper, commodity. Do not clutter the first screen.
- Keyboard: `Enter` submits; `↓` in a field opens autocomplete.

**B. Results — instrument row + map theater + logbook**

Do not navigate to a new route if it can be a shared layout. The ticket collapses to a slim top bar (edit locations in place). The page becomes:

```
[ 11h drive ████░░  8.2 ] [ 14h window ██████░ 11.0 ] [ 70h cycle ████░░░░ 42.5 ]
[ miles 1,184 ] [ 3 days of logs ] [ 2 fuel · 3 rest ]

 MAP (~58%)                              LOGBOOK (~42%)
 dark route + stops                      paper sheets, day tabs
 playback ▶ Replay this day              [Print] [PDF]
```

- **Instrument gauges** (must-have UX): three linear gauges for remaining **11h driving**, **14h window**, **70h cycle** *at the end of the trip*, plus miles and sheet count. If any gauge would have gone illegal, the planner already inserted rest — the gauge should read legal. If a 34h restart was inserted, a small stamp: `34-HR RESTART`.
- **Logbook pane:** physical stacked sheets. Day tabs on the top edge like a bound book (`DAY 1  SEP 21`). Active sheet fully visible; previous/next peek 12px of paper.
- Clicking a map stop selects the day sheet and **scrolls/highlights** the matching remark and grid segment (amber wash behind that 15-min block).
- Hovering a grid hour does the reverse: map marker lights, tooltip opens.
- **Replay this day (signature interaction):** 8–12 seconds. Match frames `14` → `17`: red vertex dots, then the black step-line grows left to right, U-brackets and diagonal remarks appear at each change; a cab marker moves on the map in the same clock time. Pause/scrub. `prefers-reduced-motion: reduce` skips to the completed sheet.
- Print / PDF: paper-white, no dark chrome, one sheet per letter page.

**C. Mobile (390px)**

- Landing: ticket over a shorter map (40vh).
- Results: map 40vh sticky; logbook below, swipeable day sheets.
- Gauges become a compact 3-up row, 11px labels.
- Replay still works; it is the demo moment on a phone too.

### 11.4 Motion and states

Motion budget: 200–400ms `cubic-bezier(0.22, 1, 0.36, 1)`. One staged sequence after a successful plan:

1. Ticket compresses to the top bar (200ms).
2. Gauges count-up numbers (400ms).
3. Route paints (1200ms).
4. Stop markers pop with 40ms stagger.
5. Log sheet slides in; **ink draws** the four-line graph (800–1200ms).
6. Totals and the circled on-duty figure stamp last (red circle draw).

| State | What the reviewer should see |
| --- | --- |
| Idle landing | Night map, ticket, sample link. No empty-state illustration clipart. |
| Geocoding a field | Spine node pulses amber; dropdown skeleton 3 lines. |
| Planning | CTA label → `Plotting HOS…`; map shows a faint search along the three points; **do not** blank the whole page. Optional 3-step microcopy: Geocoding → Routing → Drawing logs. |
| Success | Sequence above, then quiet. |
| Bad location | Field border `stamp-red`, message under the field: `Can't find that place — try City, ST`. Map does not move. |
| Routing down | Toast on the ticket: `Route service is down` + **Retry**. Keep the inputs. |
| Cycle = 70 | Plan anyway; first map callout is a 34-hour rest stamp. |
| Long trip | Day tabs, not an infinite scroll of 8 full sheets. |
| Same three cities | Inline: `Need three different points`. |

Skeleton: shimmer in `night-800`, not gray-200 (we are not on a white page).

### 11.5 Micro-interactions (do these)

- Autocomplete result: hover slides a 2px amber bar on the left.
- CTA: press scale 0.98, amber fill, arrow icon that becomes a check on success.
- Log sheet: hover lifts 2px (desktop). Active day tab is paper-colored; inactive tabs are `night-800` with paper labels.
- Circled total: SVG circle that draws 360° once.
- Copy coordinates / trip URL: silent checkmark, no browser alert.
- Sample trip: fills fields sequentially (~80ms each) so the reviewer sees the spine populate, then auto-submits.

### 11.6 What we explicitly will not do

- Generic SaaS dashboard, light theme as default, or a second “marketing landing.”
- Glassmorphism stacked on glassmorphism.
- Confetti, emoji, truck cartoon mascots.
- Animating after the first reveal except Replay and hover.
- Restyling the **legal grid** so much that it no longer matches `blank-paper-log.png`. Chrome can be extraordinary; the form must stay recognizable to an officer.
- Auto-playing music or video.

### 11.7 Accessibility (non-negotiable with the polish)

- Contrast: `fog-100` on `night-900` and `ink` on `paper` both AA. Amber on navy is for accents and large gauges, not 12px body copy.
- Focus rings: 2px `amber-400` offset. Do not remove outlines.
- Autocomplete: `listbox` / `option` ARIA, arrow keys, escape.
- Replay is supplementary; the completed log is always in the DOM.
- Log SVG: `aria-hidden` on decorative ink; adjacent **visually hidden or details** table of segments (time, status, city).
- `prefers-reduced-motion` kills ink animation, route paint, and replay; show final frames.
- Keyboard: tab through fields → CTA → map stop list → day tabs → print.

### 11.8 UX requirements (bind engineering)

| ID | Requirement | Priority |
| --- | --- | --- |
| UX1 | Dark dispatch chrome + paper log contrast as specified in §11.2 | P0 |
| UX2 | Itinerary spine + cycle tank on landing; CTA **Draw the logs** | P0 |
| UX3 | Custom dark map, custom stop glyphs, deadhead vs loaded route style | P0 |
| UX4 | Three HOS gauges (11 / 14 / 70) on results | P0 |
| UX5 | Map ↔ log bidirectional highlight | P0 |
| UX6 | First-load ink-draw of the grid + stamp circle | P0 |
| UX7 | Replay this day (map + log synced), with reduced-motion off-ramp | P1 |
| UX8 | Staged results reveal (gauges → route → markers → log) | P1 |
| UX9 | Bound-log day tabs, paper fiber, 0.4° sheet | P1 |
| UX10 | Print/PDF letter pages without dark chrome | P1 |
| UX11 | Sample trip sequential fill | P1 |
| UX12 | Planning microcopy without full-page spinner | P0 |

### 11.9 Reviewer 60-second script (design QA)

1. Open live URL on a laptop in a dim room — does it look like night ops, not a tutorial CSS template?
2. Load sample — fields fill, one click, route paints, log inks.
3. Hover a fuel stop on the map — matching remark lights.
4. Hit Replay — truck and ink agree.
5. Resize to 390px — ticket and one log still readable.
6. Print preview — white paper log, not a black blob.

---

## 12. Functional requirements

### Must have (P0)

| ID | Requirement | Acceptance |
| --- | --- | --- |
| F1 | User submits current, pickup, dropoff, cycle used | Invalid fields block submit with a clear error |
| F2 | Backend geocodes all three points | Lat/lng stored on the trip |
| F3 | Backend returns a driving route current → pickup → dropoff | Polyline + miles + duration |
| F4 | Engine inserts pickup 1h ON, dropoff 1h ON, fuel 0:30 ON / 1000 mi, 30-min break after 8h driving, 10h rest at 11h or 14h, 34h restart if cycle exhausted | Inspect timeline JSON against §8.4 |
| F5 | Map shows route and every stop/rest with time, duration, type | Manual check on sample trip |
| F6 | One filled daily log per calendar day | Multi-day trip shows 2+ sheets |
| F7 | Grid lines drawn on 15-min resolution for all four statuses | Visual check vs blank form |
| F8 | Remarks include city, ST, and activity on each status change | Matches timeline |
| F9 | Four line totals = 24:00 on every sheet | Automated test |
| F10 | No **driving** scheduled beyond 11h, 14h window, or 70h cycle | Automated test |
| F11 | Miles driving today populated | Sum of that day’s D segments |
| F12 | Recap on-duty today = lines 3+4 | Automated test |
| F13 | Hosted production URL | Opens without VPN |
| F14 | Responsive: usable at 1280px and 390px | Form + map + at least one readable log |
| F14a | Dark dispatch UI + paper log theater per §11 | 60-second design QA script passes |
| F14b | Custom map glyphs, 11/14/70 gauges, map↔log highlight, ink-draw | Visual check vs §11.8 UX1–UX6, UX12 |

### Should have (P1)

| ID | Requirement |
| --- | --- |
| F15 | Geocode autocomplete |
| F16 | Optional start time, timezone, carrier, vehicle, shipper, commodity |
| F17 | Circled D+ON decimal per Schneider |
| F18 | Non-movement brackets on stationary ON |
| F19 | Printable / PDF logs |
| F20 | Persist trip and shareable `/trips/:id` URL |
| F21 | Highlight map stop when hovering a remark (and the reverse) |
| F22 | Sample trip + Schneider goldensheet in UI or Storybook/tests |
| F22a | Replay this day; bound-log tabs; staged reveal; sequential sample fill |

### Nice to have (P2)

| ID | Requirement |
| --- | --- |
| F23 | User-resizable / zoomable log |
| F24 | Dark/light only if it does not hurt paper-log fidelity |
| F25 | Split-sleeper option |
| F26 | Co-driver field (N/A default) |

---

## 13. User stories

**US1 — Plan a legal trip**  
As a driver, I want to enter where I am, pickup, dropoff, and hours already used this cycle so that I can see a route that fits HOS.

Acceptance:

- Given valid locations and cycle used 12.5, when I plan, then I see a map and at least one log sheet.
- Given cycle used 70, when I plan a long trip, then a 34-hour restart appears before driving.

**US2 — See stops and rests**  
As a driver, I want fuel, break, and sleeper stops on the map so that I know where the clock will force me to stop.

Acceptance:

- A route over 1,000 loaded+deadhead miles includes at least one fuel marker.
- A shift with more than 8 hours driving includes a ≥30-minute non-driving stop.
- A shift that would exceed 11 driving hours or 14 elapsed hours includes a ≥10-hour rest before more driving.

**US3 — Read a real daily log**  
As a reviewer, I want logs that look like the FMCSA/Schneider paper grid so that I can verify duty status by eye.

Acceptance:

- Header, 4-line grid, remarks, shipping block, recap are present.
- Status changes have vertical connectors.
- Totals equal 24:00.
- Multi-day trips paginate or stack multiple forms.

**US4 — Trust the recap**  
As a driver, I want today’s on-duty hours applied to my 70-hour cycle so that remaining hours after the trip are visible.

Acceptance:

- Summary shows cycle remaining after the last event.
- Recap A/B/C are consistent with `current_cycle_used` plus this trip’s ON+D (approximate for days before the trip: treat unknown prior days as whatever cycle-used implies).

**US5 — Believe the logs at a glance**  
As a reviewer, I want the app to feel like a dispatch desk and a real paper log, not a CRUD demo, so that strong design can carry small output misses as the brief allows.

Acceptance:

- Landing is a night map + itinerary ticket, not a centered Bootstrap form.
- Results show 11/14/70 gauges and a paper sheet with inked grid.
- Map and log highlight the same stop.
- Replay (if shipped) keeps map position and grid time aligned within 1 second.

---

## 14. Cycle recap — prior days

The user only gives **current cycle used**, not a day-by-day history.

**Rule:** Assume the `current_cycle_used` hours all fell inside the previous 7 days before today, and that today starts with those hours already on the 8-day tape.

- At the start of Day 1 of the generated trip, hours already in the 8-day window = `current_cycle_used`.
- Each generated day’s D+ON adds to the window.
- Hours from a rolling day that falls off the 8-day window: v1 may treat pre-trip history as a lump that **does not age off** during a short generated trip (conservative: remaining hours only go down, except after a 34-hour restart). Document this in the UI: “Prior cycle hours are not aged off day-by-day because daily history was not provided.”

That conservative choice avoids inventing fake prior-day logs and keeps the driver from appearing to have **more** hours than they reported.

---

## 15. System design (for implementation, not architecture theater)

### 15.1 Shape

```
React SPA  --JSON-->  Django API
   |                      |
   | Leaflet/MapLibre     | Geocode (Nominatim)
   | SVG log sheets       | Route (OSRM / OpenRouteService)
   |                      | HOS planner (pure Python)
   |                      | Optional: Postgres trip store
```

### 15.2 Suggested API

`POST /api/trips/`

```json
{
  "current_location": "Green Bay, WI",
  "pickup_location": "Chicago, IL",
  "dropoff_location": "Dallas, TX",
  "current_cycle_used_hours": 20,
  "start_time": "06:00",
  "timezone": "America/Chicago"
}
```

Response (conceptual):

```json
{
  "id": "…",
  "summary": {
    "total_miles": 0,
    "total_driving_hours": 0,
    "days": 0,
    "cycle_remaining_hours": 0
  },
  "route": { "geometry": [], "legs": [] },
  "stops": [
    {
      "type": "pre_trip|pickup|fuel|break|rest|dropoff|post_trip|restart_34",
      "status": "OFF|SB|D|ON",
      "start": "ISO-8601",
      "end": "ISO-8601",
      "lat": 0,
      "lng": 0,
      "city": "",
      "state": "",
      "notes": ""
    }
  ],
  "logs": [
    {
      "date": "YYYY-MM-DD",
      "from": "",
      "to": "",
      "miles_driving": 0,
      "segments": [
        { "start": "00:00", "end": "06:00", "status": "OFF", "location": null, "notes": null }
      ],
      "totals": { "off": "8:30", "sb": "5:00", "driving": "9:30", "on": "1:00" },
      "on_duty_today": "10.5",
      "remarks": [],
      "recap": { "on_duty_today": 10.5, "a": 0, "b": 0, "c": 0 }
    }
  ]
}
```

The React app must be able to draw logs **entirely from `logs[]`**. Do not re-implement HOS on the client.

### 15.3 Free APIs (candidates)

| Need | Candidate | Notes |
| --- | --- | --- |
| Geocoding | Nominatim (OSM) | Respect usage policy; cache; User-Agent required |
| Routing | public OSRM, OpenRouteService (api key), GraphHopper | Truck profile if available; car profile acceptable for v1 |
| Tiles | OSM / MapLibre demo tiles, or Carto positron | Attribution required |

No paid Mapbox/Google requirement. If a key is needed (ORS), keep it server-side.

### 15.4 Hosting

- Frontend: Vercel.
- Django: Render, Railway, Fly.io, or similar, HTTPS.
- CORS locked to the Vercel origin.
- README: env vars, local run, sample request, Loom link, live URL.

---

## 16. Accuracy bar (what reviewers will test)

Expect hidden test trips (short city hop, ~500 miles, 1,200+ miles, cycle used near 70).

1. **Grid arithmetic:** every day 24:00; no overlapping segments; no gaps.
2. **Status semantics:** pickup/dropoff are ON 1:00, not driving; rest is OFF/SB not ON; driving only on the route.
3. **11 / 14 / 8-hour break / 70-hour** never violated by a D segment.
4. **Fuel** appears by 1,000 miles.
5. **Remarks** exist for each change and include a place.
6. **Multiple sheets** when the timeline crosses midnight.
7. **Deadhead then loaded:** current→pickup then pickup→dropoff, not a single straight line that skips pickup.

Prefer a slightly conservative plan (more rest) over an illegal one.

---

## 17. Quality and testing

- Unit tests on the planner: 11-hour stop, 14-hour stop, 8-hour break, 1000-mile fuel, 70-hour restart, 24-hour totals, 15-minute quantization.
- Fixture test: Schneider totals (8:30 / 5:00 / 9:30 / 1:00 / 10.5 / 472 miles) if the golden timeline is encoded.
- One API integration test with mocked geocode+route.
- Frontend: log totals rendered match JSON; form validation.

---

## 18. Success metrics (assessment)

| Metric | Target |
| --- | --- |
| Hosted happy path | Reviewer completes a trip in < 2 minutes |
| HOS violations in generated driving | **Zero** |
| Log days vs midnight crossings | Exact match |
| Visual | Recognizable as a Driver’s Daily Log from 5 feet |
| Loom | 3–5 minutes: demo the trip, then show planner + log renderer code |
| Reward criterion | Accuracy first; UI can offset minor output issues |

---

## 19. Open questions and decided defaults

| Question | Decision for v1 |
| --- | --- |
| Start time not in the brief | **06:00** home terminal, optional override |
| Pre/post-trip duration | **15 minutes** ON each (video used 30 for pre-trip+TI; 15 keeps more driving room) |
| Fuel duration | **30 minutes** ON |
| Where to take 10-hour rest | End of the driving segment that hit the limit, snapped to the route |
| OFF vs SB for daily rest | **30 min OFF** (post-trip style) + remainder **SB** if rest ≥ 10h; short 30-min break stays **OFF** |
| Truck numbers / carrier / shipper | Placeholders; optional form fields |
| Co-driver | `N/A` |
| Time zone | `America/Chicago` default |
| Aging of prior cycle hours | Conservative lump; no invented prior logs |
| Split sleeper | Not in v1 |
| Auth | None |

---

## 20. Implementation sequence

1. Django project: geocode + route + dummy timeline (no HOS) + JSON.
2. HOS planner with tests for 11/14/8/70/fuel/24h.
3. React **design shell first**: night tokens, dispatch ticket, gauges, dark map, empty paper sheet (before API).
4. SVG log renderer against `blank-paper-log.png`; Schneider fixture; ink-draw.
5. Wire API: remarks, recap, circled total, multi-day tabs, map↔log highlight.
6. Replay, staged reveal, sample fill, print, reduced-motion, 390px.
7. Run §11.9 design QA, then deploy, README, Loom.

---

## 21. Appendix A — Duty status cheatsheet

| Activity | Status |
| --- | --- |
| Sleeping in berth | SB |
| 30-minute rest break (not working) | OFF |
| Pre-trip, TI, post-trip | ON |
| Fuel, scale, wash | ON |
| Loading / unloading / waiting on freight if not relieved | ON |
| Behind the wheel, CMV moving | D |
| 10-hour or 34-hour restart not working | OFF and/or SB |
| Lunch with no work responsibility | OFF |

---

## 22. Appendix B — Paper form recap labels (from `blank-paper-log.png`)

Copy these labels onto the sheet for fidelity:

- Recap complete at end of day
- On duty hours today, Total lines 3 & 4
- 70 Hour / 8 Day Drivers: A last 7 days including today; B available tomorrow (70 − A\*); C last 8 days
- 60 Hour / 7 Day Drivers: shown for form completeness, unused
- \*If you took 34 consecutive hours off duty you have 60/70 hours available
- Remarks: “Enter name of place you reported and where released from work and when and where each change of duty occurred. Use time standard of home terminal.”

---

## 23. Appendix C — Source map

| PRD section | Source |
| --- | --- |
| Inputs, outputs, assumptions, deliverables, stack | Assessment DOCX |
| 14h, 11h, 30-min, 70/8, 34h restart, on/off duty definitions | FMCSA guide |
| RODS fields, grid drawing, remarks, completed log | FMCSA guide pp. 14–19 |
| Highlighted rule set | `fmsca-image.png` TOC |
| Form layout, recap boxes, 15-min ticks | `blank-paper-log.png` |
| Fill order, remarks list, TI = trailer integrity, brackets, 10.5 circle | `youtube trasncript.txt` |
| Step-line, red dots, U-brackets, diagonal remarks, HH/MM boxes | `refs/youtube/` frames |
