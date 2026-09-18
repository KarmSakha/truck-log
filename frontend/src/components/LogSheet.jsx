import { useMemo } from "react";

/* =================== sheet geometry (viewBox units) =================== */
export const W = 1280;
export const H = 980;
const M = 40;

const GRID_X = 190;
const GRID_W = 960;            // 24h * 40px
const GRID_Y = 210;
const ROW_H = 48;
const GRID_H = ROW_H * 4;      // 192
const GRID_B = GRID_Y + GRID_H;
const TOT_X = GRID_X + GRID_W; // 1150
const TOT_W = W - M - TOT_X;   // 90

const ROWS = [
  { status: "OFF", label: ["1 : OFF DUTY"], tint: "#8b93a1" },
  { status: "SB", label: ["2 : SLEEPER", "BERTH"], tint: "#6e7aa8" },
  { status: "D", label: ["3 : DRIVING"], tint: "#e8a317" },
  { status: "ON", label: ["4 : ON DUTY", "(NOT DRIVING)"], tint: "#c45c26" },
];

const FORM_TXT = "#4a5390";
const FORM_LINE = "#8b94c4";
const FORM_LINE_SOFT = "#b9c0dd";
const INK = "#1c1914";
const RED = "#b42318";

const STATUS_NAMES = { OFF: "Off Duty", SB: "Sleeper Berth", D: "Driving", ON: "On Duty (not driving)" };

const xOf = (min) => GRID_X + (min / 1440) * GRID_W;
const rowY = (status) => GRID_Y + ROW_H * ROWS.findIndex(r => r.status === status) + ROW_H / 2;

const HOUR_LABELS = [
  "Midnight", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11",
  "noon", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "Midnight",
];

/* small helper: a boxed handwritten number */
function DigitBoxes({ x, y, value, boxes = 2, boxW = 26, boxH = 30, size = 20 }) {
  const digits = String(value).padStart(boxes, " ").slice(-boxes);
  return (
    <g>
      {digits.split("").map((d, i) => (
        <g key={i}>
          <rect
            x={x + i * (boxW + 4)}
            y={y}
            width={boxW}
            height={boxH}
            fill="none"
            stroke={FORM_LINE}
            strokeWidth="1.2"
          />
          {d.trim() !== "" && (
            <text
              x={x + i * (boxW + 4) + boxW / 2}
              y={y + boxH / 2 + size * 0.34}
              textAnchor="middle"
              fontSize={size}
              fontFamily="var(--hand)"
              fontWeight="600"
              fill={INK}
            >
              {d}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function FillLine({ x1, x2, y, label, value, labelAbove = true }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={FORM_LINE} strokeWidth="1.2" />
      {labelAbove && (
        <text x={x1 + 2} y={y - 4} fontSize="9.5" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.04em">
          {label}
        </text>
      )}
      {value && (
        <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fontSize="21"
          fontFamily="var(--hand)" fontWeight="600" fill={INK}>
          {value}
        </text>
      )}
    </g>
  );
}

/* ============================ the sheet ============================ */

export default function LogSheet({ log, meta, inkProgress = 1, highlightMin = null, onSegmentHover }) {
  const ip = Math.max(0, Math.min(1, inkProgress));

  /* ---- ink polyline: vertices + cumulative length ---- */
  const { path, vertices, cumLens, remarkDoneAt, totalLen } = useMemo(() => {
    const segs = log.segments;
    const verts = [];
    let d = "";
    let len = 0;
    const cum = [];
    segs.forEach((s) => {
      const y = rowY(s.status);
      [[xOf(s.start_min), y], [xOf(s.end_min), y]].forEach(([px, py]) => {
        if (verts.length) {
          const [lx, ly] = verts[verts.length - 1];
          len += Math.abs(px - lx) + Math.abs(py - ly);
        }
        verts.push([px, py]);
        cum.push(len);
        d += (d ? " L" : "M") + `${px.toFixed(1)} ${py.toFixed(1)}`;
      });
    });
    // remark reveal = when the pen reaches the END of the remarked segment
    const rDone = log.remarks.map((r) => {
      const xEnd = xOf(r.seg_end_min);
      let best = 0;
      cum.forEach((c, i) => {
        if (Math.abs(verts[i][0] - xEnd) < 0.6) best = c;
      });
      return best;
    });
    return { path: d, vertices: verts, cumLens: cum, remarkDoneAt: rDone, totalLen: len };
  }, [log]);

  const drawnLen = ip * totalLen;

  /* remark lanes to avoid collisions */
  const remarkLayout = useMemo(() => {
    const lanes = [];
    return log.remarks.map((r, i) => {
      const anchorX = Math.min(Math.max(xOf((r.seg_start_min + r.seg_end_min) / 2) + 60, 250), 1140);
      let lane = 0;
      while (lanes[lane] !== undefined && anchorX - lanes[lane] < 170) lane++;
      lanes[lane] = anchorX;
      return { ...r, anchorX, lane, doneAt: remarkDoneAt[i] };
    });
  }, [log, remarkDoneAt]);

  const d = new Date(log.date + "T12:00:00");
  const [mm, dd, yy] = [
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    String(d.getFullYear()).slice(2),
  ];

  const totals = log.totals;
  const totRows = [
    { label: "off", hh: Math.floor(totals.off_min / 60), mm: totals.off_min % 60 },
    { label: "sb", hh: Math.floor(totals.sb_min / 60), mm: totals.sb_min % 60 },
    { label: "driving", hh: Math.floor(totals.driving_min / 60), mm: totals.driving_min % 60 },
    { label: "on", hh: Math.floor(totals.on_min / 60), mm: totals.on_min % 60 },
  ];

  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Driver's daily log for ${log.date}`}
      fontFamily="var(--sans)">
      {/* ============ HEADER ============ */}
      <text x={M} y={52} fontSize="27" fontWeight="700"
        fontFamily="var(--condensed)" letterSpacing="0.1em" fill={FORM_TXT}>
        DRIVER&apos;S DAILY LOG
      </text>
      <text x={M + 2} y={74} fontSize="12" fill={FORM_TXT}
        fontFamily="var(--condensed)" letterSpacing="0.06em">
        (24 HOURS)
      </text>

      {/* date */}
      <g>
        {[["MONTH", mm, M + 310], ["DAY", dd, M + 392], ["YEAR", yy, M + 474]].map(
          ([lbl, v, x]) => (
            <g key={lbl}>
              <DigitBoxes x={x} y={30} value={v} boxes={2} boxW={26} boxH={30} />
              <text x={x + 28} y={72} fontSize="9" fill={FORM_TXT}
                fontFamily="var(--condensed)" letterSpacing="0.06em">
                {lbl}
              </text>
            </g>
          )
        )}
      </g>

      {/* original / duplicate legal line */}
      <g>
        <rect x={W - M - 330} y={26} width={330} height={40}
          fill="none" stroke={FORM_LINE} strokeWidth="1" />
        <text x={W - M - 322} y={43} fontSize="9.5" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.03em">
          ORIGINAL — FILE AT HOME TERMINAL.
        </text>
        <text x={W - M - 322} y={58} fontSize="9.5" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.03em">
          DUPLICATE — DRIVER RETAINS IN POSSESSION FOR 8 DAYS.
        </text>
      </g>

      {/* from / to */}
      <FillLine x1={M + 40} x2={M + 300} y={116} label="" value={log.from} />
      <text x={M} y={116} fontSize="11" fill={FORM_TXT} fontFamily="var(--condensed)"
        letterSpacing="0.05em" fontWeight="600">FROM</text>
      <FillLine x1={M + 330} x2={M + 560} y={116} label="" value={log.to} />
      <text x={M + 304} y={116} fontSize="11" fill={FORM_TXT} fontFamily="var(--condensed)"
        letterSpacing="0.05em" fontWeight="600">TO</text>

      {/* right column fields */}
      <FillLine x1={700} x2={W - M} y={104} label="NAME OF CARRIER OR CARRIERS" value={meta?.carrier} />
      <FillLine x1={700} x2={W - M} y={136} label="MAIN OFFICE ADDRESS" value={meta?.main_office} />
      <FillLine x1={700} x2={W - M} y={168} label="HOME TERMINAL ADDRESS" value={meta?.home_terminal} />

      {/* miles + truck line */}
      <g>
        <text x={M} y={156} fontSize="10" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.04em">
          TOTAL MILES DRIVING TODAY
        </text>
        <DigitBoxes x={M + 168} y={134} value={log.miles_driving} boxes={3} />
        <text x={M + 280} y={156} fontSize="10" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.04em">
          TOTAL MILEAGE TODAY
        </text>
        <DigitBoxes x={M + 428} y={134} value={String(log.miles_driving).padStart(4, "0")} boxes={4} />
      </g>
      <FillLine x1={M} x2={660} y={192}
        label="TRUCK/TRACTOR AND TRAILER NUMBERS OR LICENSE PLATE(S)/STATE (SHOW EACH UNIT)"
        value={meta && meta.tractor !== "N/A" ? `${meta.tractor} / ${meta.trailer}` : "N/A"} />

      {/* ============ GRID ============ */}
      <g>
        {/* row tint washes */}
        {ROWS.map((r, i) => (
          <rect key={r.status} x={GRID_X} y={GRID_Y + i * ROW_H}
            width={GRID_W} height={ROW_H} fill={r.tint} opacity="0.07" />
        ))}

        {/* 15-min ticks inside each row: :15/:45 down from top, :30 up from bottom */}
        {ROWS.map((r, ri) =>
          Array.from({ length: 24 }, (_, h) => {
            const base = GRID_X + h * 40;
            const top = GRID_Y + ri * ROW_H;
            const bot = top + ROW_H;
            return [10, 20, 30].map((off, k) => (
              <line
                key={`${ri}-${h}-${k}`}
                x1={base + off} x2={base + off}
                y1={k === 1 ? bot - 11 : top}
                y2={k === 1 ? bot : top + 7}
                stroke={FORM_LINE_SOFT} strokeWidth="0.9"
              />
            ));
          })
        )}

        {/* hour lines */}
        {Array.from({ length: 25 }, (_, h) => (
          <line key={h} x1={GRID_X + h * 40} x2={GRID_X + h * 40}
            y1={GRID_Y} y2={GRID_B}
            stroke={FORM_LINE}
            strokeWidth={h === 0 || h === 12 || h === 24 ? 1.6 : 1.05} />
        ))}
        {/* row lines */}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={i} x1={GRID_X} x2={TOT_X}
            y1={GRID_Y + i * ROW_H} y2={GRID_Y + i * ROW_H}
            stroke={FORM_LINE} strokeWidth={i === 0 || i === 4 ? 1.6 : 1.05} />
        ))}

        {/* hour labels top + bottom */}
        {HOUR_LABELS.map((t, h) => (
          <g key={h}>
            <text x={GRID_X + h * 40} y={GRID_Y - 7} textAnchor="middle"
              fontSize={t.length > 2 ? 10 : 12.5} fill={FORM_TXT}
              fontFamily="var(--condensed)" fontWeight="500">
              {t}
            </text>
            <text x={GRID_X + h * 40} y={GRID_B + 16} textAnchor="middle"
              fontSize={t.length > 2 ? 10 : 12.5} fill={FORM_TXT}
              fontFamily="var(--condensed)" fontWeight="500">
              {t}
            </text>
          </g>
        ))}

        {/* row labels */}
        {ROWS.map((r, i) => (
          <g key={r.status}>
            {r.label.map((ln, j) => (
              <text key={j} x={GRID_X - 12}
                y={GRID_Y + i * ROW_H + ROW_H / 2
                   + (r.label.length - 1) * -7 + j * 15 + 5}
                textAnchor="end" fontSize="14.5" fontWeight="600"
                fill={FORM_TXT} fontFamily="var(--condensed)"
                letterSpacing="0.02em">
                {ln}
              </text>
            ))}
          </g>
        ))}

        {/* totals column */}
        <rect x={TOT_X} y={GRID_Y} width={TOT_W} height={GRID_H}
          fill="none" stroke={FORM_LINE} strokeWidth="1.4" />
        <text x={TOT_X + TOT_W / 2} y={GRID_Y - 30} textAnchor="middle"
          fontSize="11" fontWeight="600" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.06em">
          TOTAL
        </text>
        <text x={TOT_X + TOT_W / 2} y={GRID_Y - 16} textAnchor="middle"
          fontSize="11" fontWeight="600" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.06em">
          HOURS
        </text>
        {totRows.map((r, i) => (
          <g key={r.label}>
            <line x1={TOT_X} x2={W - M} y1={GRID_Y + i * ROW_H}
              y2={GRID_Y + i * ROW_H} stroke={FORM_LINE} strokeWidth="1" />
            <rect x={TOT_X + 10} y={GRID_Y + i * ROW_H + 9} width={28} height={30}
              fill="none" stroke={FORM_LINE} strokeWidth="1" />
            <rect x={TOT_X + 48} y={GRID_Y + i * ROW_H + 9} width={28} height={30}
              fill="none" stroke={FORM_LINE} strokeWidth="1" />
            <text x={TOT_X + 24} y={GRID_Y + i * ROW_H + 31} textAnchor="middle"
              fontSize="19" fontFamily="var(--hand)" fontWeight="700" fill={INK}>
              {String(r.hh).padStart(2, "0")}
            </text>
            <text x={TOT_X + 62} y={GRID_Y + i * ROW_H + 31} textAnchor="middle"
              fontSize="19" fontFamily="var(--hand)" fontWeight="700" fill={INK}>
              {String(r.mm).padStart(2, "0")}
            </text>
          </g>
        ))}
        {/* day total under totals column */}
        <rect x={TOT_X + 10} y={GRID_B + 12} width={28} height={30}
          fill="none" stroke={FORM_LINE} strokeWidth="1" />
        <rect x={TOT_X + 48} y={GRID_B + 12} width={28} height={30}
          fill="none" stroke={FORM_LINE} strokeWidth="1" />
        <text x={TOT_X + 24} y={GRID_B + 34} textAnchor="middle" fontSize="20"
          fontFamily="var(--hand)" fontWeight="700" fill={INK}>
          24
        </text>
        <text x={TOT_X + 62} y={GRID_B + 34} textAnchor="middle" fontSize="20"
          fontFamily="var(--hand)" fontWeight="700" fill={INK}>
          00
        </text>

        {/* grid segment highlight (map<->log) */}
        {highlightMin != null && (
          <rect className="grid-flash"
            x={xOf(Math.floor(highlightMin / 15) * 15)} y={GRID_Y}
            width={10} height={GRID_H}
            fill="#e8a317" opacity="0.28" />
        )}

        {/* hover layer: grid time -> segment -> map stop */}
        {onSegmentHover && (
          <rect
            x={GRID_X} y={GRID_Y} width={GRID_W} height={GRID_H}
            fill="transparent" pointerEvents="all" style={{ cursor: "crosshair" }}
            onMouseMove={(e) => {
              const svg = e.currentTarget.ownerSVGElement;
              const pt = svg.createSVGPoint();
              pt.x = e.clientX; pt.y = e.clientY;
              const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
              const min = Math.round(((loc.x - GRID_X) / GRID_W) * 1440 / 15) * 15;
              const seg = log.segments.find(
                (s) => min >= s.start_min && min < s.end_min
              );
              onSegmentHover(seg?.stop_id ?? null);
            }}
            onMouseLeave={() => onSegmentHover(null)}
          />
        )}

        {/* ===== INK ===== */}
        <g aria-hidden="true">
          <path d={path} fill="none" stroke={INK} strokeWidth="3.6"
            strokeLinecap="round" strokeLinejoin="round"
            pathLength={totalLen}
            strokeDasharray={totalLen}
            strokeDashoffset={totalLen - drawnLen} />
          {vertices.map(([vx, vy], i) =>
            cumLens[i] <= drawnLen + 0.01 ? (
              <circle key={i} cx={vx} cy={vy} r="3.8" fill={RED} />
            ) : null
          )}
        </g>

        {/* brackets (staples) + diagonal remarks */}
        <g aria-hidden="true">
          {remarkLayout.map((r, i) => {
            if (r.doneAt > drawnLen + 0.01) return null;
            const bx1 = xOf(r.seg_start_min);
            const bx2 = xOf(r.seg_end_min);
            return (
              <g key={i}
                onMouseEnter={() => onSegmentHover?.(r.stop_id ?? null)}
                onMouseLeave={() => onSegmentHover?.(null)}>
                {r.bracket && (
                  <path
                    d={`M ${bx1} ${GRID_B + 4} v 12 H ${bx2} v -12`}
                    fill="none" stroke={INK} strokeWidth="2.4"
                    strokeLinecap="round" />
                )}
                <g transform={`rotate(-45 ${r.anchorX} ${GRID_B + 74 + r.lane * 44})`}>
                  <text x={r.anchorX} y={GRID_B + 74 + r.lane * 44}
                    textAnchor="end" fontSize="17" fontWeight="600"
                    fontFamily="var(--hand)" fill={INK}>
                    {[r.city, r.state].filter(Boolean).join(", ")}
                  </text>
                  <text x={r.anchorX} y={GRID_B + 74 + r.lane * 44 + 16}
                    textAnchor="end" fontSize="15.5" fontWeight="500"
                    fontFamily="var(--hand)" fill={INK}>
                    {r.activity}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </g>

      {/* ============ REMARKS BOX ============ */}
      <g>
        <rect x={M} y={430} width={W - 2 * M} height={196}
          fill="none" stroke={FORM_LINE} strokeWidth="1.2" />
        <rect x={M + 14} y={423} width={86} height={15} fill="var(--paper)" />
        <text x={M + 20} y={434} fontSize="11" fontWeight="600" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.08em">
          REMARKS
        </text>
        <text x={M + 14} y={618} fontSize="9" fill={FORM_TXT} fontStyle="italic"
          fontFamily="var(--sans)">
          Enter name of place you reported and where released from work and when
          and where each change of duty occurred. Use time standard of home terminal.
        </text>
      </g>

      {/* ============ SHIPPING ============ */}
      <g>
        <text x={M} y={664} fontSize="12" fontWeight="700" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.06em">
          SHIPPING DOCUMENTS:
        </text>
        <FillLine x1={M + 190} x2={640} y={664} label="DVL OR MANIFEST NO."
          value={meta?.manifest} />
        <FillLine x1={680} x2={W - M} y={664} label="SHIPPER &amp; COMMODITY"
          value={meta && meta.shipper !== "N/A" ? `${meta.shipper} — ${meta.commodity}` : "N/A"} />
      </g>

      {/* ============ RECAP ============ */}
      <g>
        <text x={M} y={712} fontSize="12" fontWeight="700" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.06em">
          RECAP — COMPLETE AT END OF DAY
        </text>
        <text x={W - M} y={712} textAnchor="end" fontSize="10" fill={FORM_TXT}
          fontFamily="var(--condensed)" letterSpacing="0.04em">
          *IF YOU TOOK 34 CONSECUTIVE HOURS OFF DUTY YOU HAVE 60/70 HOURS AVAILABLE
        </text>

        {/* column headers */}
        <rect x={740} y={726} width={230} height={26} fill="none" stroke={FORM_LINE} strokeWidth="1" />
        <rect x={986} y={726} width={254} height={26} fill="none" stroke={FORM_LINE} strokeWidth="1" />
        <text x={855} y={743} textAnchor="middle" fontSize="11" fontWeight="600"
          fill={FORM_TXT} fontFamily="var(--condensed)" letterSpacing="0.05em">
          70 HOUR / 8 DAY DRIVERS
        </text>
        <text x={1113} y={743} textAnchor="middle" fontSize="11" fontWeight="600"
          fill={FORM_TXT} fontFamily="var(--condensed)" letterSpacing="0.05em">
          60 HOUR / 7 DAY DRIVERS
        </text>

        {/* recap rows */}
        {[
          { lbl: "ON DUTY HOURS TODAY (TOTAL LINES 3 & 4)", v: log.recap.on_duty_today },
          { lbl: "A. TOTAL HOURS ON DUTY LAST 7 DAYS INCLUDING TODAY", v: log.recap.a },
          { lbl: "B. TOTAL HOURS AVAILABLE TOMORROW (70 − A*)", v: log.recap.b },
          { lbl: "C. TOTAL HOURS ON DUTY LAST 8 DAYS", v: log.recap.c },
        ].map((r, i) => {
          const y = 752 + i * 34;
          return (
            <g key={i}>
              <text x={M} y={y + 22} fontSize="10.5" fill={FORM_TXT}
                fontFamily="var(--condensed)" letterSpacing="0.03em">
                {r.lbl}
              </text>
              <rect x={740} y={y} width={230} height={30} fill="none"
                stroke={FORM_LINE} strokeWidth="1" />
              <rect x={986} y={y} width={254} height={30} fill="none"
                stroke={FORM_LINE} strokeWidth="1" />
              <text x={855} y={y + 23} textAnchor="middle" fontSize="19"
                fontFamily="var(--hand)" fontWeight="700" fill={INK}>
                {i === 0 ? r.v : r.v}
              </text>
              <text x={1113} y={y + 23} textAnchor="middle" fontSize="15"
                fontFamily="var(--hand)" fontWeight="600" fill="#9a8f7c">
                N/A
              </text>
            </g>
          );
        })}
      </g>

      {/* ============ circled on-duty decimal ============ */}
      {ip > 0.9 && (
        <g>
          <text x={1100} y={560} textAnchor="middle" fontSize="34"
            fontFamily="var(--hand)" fontWeight="700" fill={INK}>
            {log.on_duty_decimal}
          </text>
          <ellipse cx={1100} cy={550} rx={52} ry={34}
            fill="none" stroke={RED} strokeWidth="3.4"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 * (1 - (ip - 0.9) / 0.1)}
            transform={`rotate(-6 1100 550)`}
            strokeLinecap="round" />
        </g>
      )}
    </svg>
    {/* visually-hidden segment table for screen readers (PRD §11.7) */}
    <table className="vh-only">
      <caption>Duty status segments for {log.date}</caption>
      <thead>
        <tr><th>Start</th><th>End</th><th>Status</th><th>Location</th></tr>
      </thead>
      <tbody>
        {log.segments.map((s, i) => {
          const f = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          return (
            <tr key={i}>
              <td>{f(s.start_min)}</td>
              <td>{f(s.end_min)}</td>
              <td>{STATUS_NAMES[s.status] || s.status}</td>
              <td>{s.city ? `${s.city}, ${s.state || ""}` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}
