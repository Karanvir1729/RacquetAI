import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { calendarWeeks, type CalendarDay } from "@/players/aggregate";
import type { PlayerClip } from "@/players/shape";

/**
 * The recordings calendar — a year of days, one square each, the way a commit
 * graph shows a year of work. The user's own words for it were "each
 * recording becomes a cell": a profile should show at a glance how often this
 * player has been filmed and when, before anyone reads a number.
 *
 * Columns are weeks (oldest on the left), rows Monday to Sunday; the maths is
 * all in `calendarWeeks`, this file only paints. Level 0 is the hairline
 * colour so an empty day still draws the grid; levels 1–4 are the data ink at
 * rising opacity, relative to the busiest day (a sparse profile still lights
 * up). Days after today are left blank rather than drawn as "nothing
 * happened".
 *
 * The grid is a fixed ~730px wide — 52 columns of 11px squares with 3px gaps
 * — and scrolls inside its own box on a phone, never the page. It opens
 * scrolled to the right-hand end because the recent weeks are the ones a
 * coach is looking for.
 *
 * A cell is a button when the caller wants to know which day was pressed
 * ("by clicking on the github box I should be able to tell what video it
 * was"): the caller owns the selection and renders the day's recordings
 * underneath. Tab stops rove — only lit days (and the open one) are in the
 * tab order, because 364 stops for 364 empty days would make the keyboard
 * useless; the empty days stay clickable so a pointer can still ask "nothing
 * that day?". Escape on a cell closes the open day, and when the open day is
 * closed from the panel below with focus inside it (Escape, its close
 * button), focus comes back to its cell so a keyboard user is not dropped on
 * the page body.
 */

const CELL = 11;
const GAP = 3;
const WEEKDAY_LABELS: Record<number, string> = { 0: "Mon", 2: "Wed", 4: "Fri" };
const LEVEL_OPACITY: Record<CalendarDay["level"], number> = {
  0: 1,
  1: 0.35,
  2: 0.55,
  3: 0.8,
  4: 1,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-21" → "21 Aug 2026". Deterministic on purpose (no `toLocale*`, the
 * rule format.ts keeps so a screenshot is the same screenshot everywhere). It
 * lives with the calendar because the calendar is where a day is first spoken
 * on a profile; the recordings list and the roster's "last played" borrow it
 * so a date reads identically wherever a profile appears. Anything that is
 * not YYYY-MM-DD passes through untouched.
 */
export function formatIsoDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  const year = match[1] ?? "";
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (month === undefined || !Number.isFinite(day)) return iso;
  return `${day} ${month} ${year}`;
}

function cellLabel(day: CalendarDay): string {
  const when = formatIsoDay(day.date);
  if (day.count === 0) return `${when} — no recordings`;
  const recordings = `${day.count} ${day.count === 1 ? "recording" : "recordings"}`;
  const minutes = `${Math.max(1, Math.round(day.minutes))} min`;
  const titles = day.titles.length > 0 ? ` — ${day.titles.join(", ")}` : "";
  return `${when} — ${recordings} · ${minutes}${titles}`;
}

/**
 * The lit cells carry their opacity as a custom property rather than a plain
 * inline `opacity`, so the hover bump can be a class (`hover:opacity-100`)
 * — an inline opacity would beat any hover rule, and a JS hover state for
 * 364 cells is the wrong tool.
 */
function cellStyle(day: CalendarDay): CSSProperties {
  if (!day.inRange) return { width: CELL, height: CELL, background: "transparent" };
  if (day.level === 0) return { width: CELL, height: CELL, background: "var(--rq-line)" };
  return {
    width: CELL,
    height: CELL,
    background: "var(--rq-data)",
    "--rq-cell-opacity": LEVEL_OPACITY[day.level],
  } as CSSProperties;
}

/** The selection outline is the site's ink ring, tight to the cell; it sits inside the 3px gap. */
const SELECTED_STYLE: CSSProperties = {
  outline: "2px solid var(--rq-accent-text)",
  outlineOffset: 1,
};

export function ContributionGrid({
  clips,
  heading = "Recordings",
  today,
  selectedDay = null,
  onSelectDay,
}: {
  clips: readonly PlayerClip[];
  /** The micro label over the grid. */
  heading?: string;
  /** Injectable for tests and the sample; defaults to now. */
  today?: Date;
  /** The day whose recordings are open below the grid (YYYY-MM-DD); null = none. */
  selectedDay?: string | null;
  /**
   * A cell was pressed: its day, or null when the open day is pressed again.
   * Without it the cells are plain pictures, as they were.
   */
  onSelectDay?: (date: string | null) => void;
}) {
  const calendar = useMemo(() => calendarWeeks(clips, today ?? new Date()), [clips, today]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const cells = useRef<HTMLDivElement | null>(null);
  const previousSelected = useRef<string | null>(selectedDay);
  const interactive = onSelectDay !== undefined;

  // Open on the recent end. `scrollLeft` past the max clamps, so no measuring.
  useEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollLeft = node.scrollWidth;
  }, [calendar]);

  // The open day closed (Escape or the close button in the panel below, which
  // unmounts with the focus in it): if focus went with the panel, put it back
  // on the cell it came from. Only then — a selection cleared while focus is
  // elsewhere (the clips changed under an edit in the recordings list) must
  // not pull it up to the calendar — and with `preventScroll`, because the
  // cell is right above the panel and the page must not jump.
  useEffect(() => {
    const previous = previousSelected.current;
    previousSelected.current = selectedDay;
    if (selectedDay !== null || previous === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const cell = cells.current?.querySelector<HTMLButtonElement>(`[data-date="${previous}"]`);
    cell?.focus({ preventScroll: true });
  }, [selectedDay]);

  const onCellsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && selectedDay !== null && onSelectDay !== undefined) {
      event.preventDefault();
      onSelectDay(null);
    }
  };

  const columns = calendar.weeks.length;
  const gridWidth = columns * CELL + Math.max(0, columns - 1) * GAP;
  const summary = `${calendar.inWindow} ${calendar.inWindow === 1 ? "recording" : "recordings"} in the last 12 months`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="rq-micro-label">{heading}</p>
        <p className="rq-num text-[13px]" style={{ color: "var(--rq-text-dim)" }}>
          {summary}
        </p>
      </div>

      <div ref={scroller} className="mt-3 overflow-x-auto pb-1">
        <div className="flex items-start" style={{ gap: 6, width: "max-content" }}>
          {/* Weekday gutter. Sits below the month row, so it gets the same
              top spacer the cells do. */}
          <div aria-hidden="true" className="flex flex-col" style={{ gap: GAP, paddingTop: 16 }}>
            {Array.from({ length: 7 }, (_, row) => (
              <span
                key={row}
                className="rq-num block text-right text-[10px] font-semibold leading-none"
                style={{ height: CELL, lineHeight: `${CELL}px`, color: "var(--rq-text-dim)", minWidth: 24 }}
              >
                {WEEKDAY_LABELS[row] ?? ""}
              </span>
            ))}
          </div>

          <div>
            {/* Month labels ride the same column track as the cells, so each
                sits exactly over the week its month began in. */}
            <div
              aria-hidden="true"
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${CELL}px)`,
                columnGap: GAP,
                height: 16,
                width: gridWidth,
              }}
            >
              {calendar.months.map((month) => (
                <span
                  key={`${month.col}-${month.label}`}
                  className="text-[10px] font-semibold leading-none"
                  style={{ gridColumn: month.col + 1, whiteSpace: "nowrap", color: "var(--rq-text-dim)" }}
                >
                  {month.label}
                </span>
              ))}
            </div>

            <div
              ref={cells}
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${CELL}px)`,
                gridTemplateRows: `repeat(7, ${CELL}px)`,
                gridAutoFlow: "column",
                gap: GAP,
                width: gridWidth,
              }}
              onKeyDown={interactive ? onCellsKeyDown : undefined}
            >
              {calendar.weeks.map((week) =>
                week.map((day) => {
                  if (!day.inRange) {
                    return <span key={day.date} aria-hidden="true" className="block" style={cellStyle(day)} />;
                  }
                  if (!interactive) {
                    return (
                      <span
                        key={day.date}
                        role="img"
                        title={cellLabel(day)}
                        aria-label={cellLabel(day)}
                        className={cn("block rounded-[2px]", day.level > 0 && "opacity-[var(--rq-cell-opacity)]")}
                        style={cellStyle(day)}
                      />
                    );
                  }
                  const selected = day.date === selectedDay;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      data-date={day.date}
                      title={cellLabel(day)}
                      aria-label={cellLabel(day)}
                      aria-pressed={selected}
                      // Roving: lit days and the open day are the tab stops.
                      tabIndex={day.count > 0 || selected ? 0 : -1}
                      onClick={() => onSelectDay(selected ? null : day.date)}
                      // The button itself stays at full opacity: element opacity
                      // would dim the selection outline and the focus ring with
                      // the fill (a 35% ring is a pale line). The level opacity
                      // lives on the inner fill, as the iOS grid does it.
                      className="group relative block cursor-pointer rounded-[2px] border-0 bg-transparent p-0"
                      style={
                        selected
                          ? { width: CELL, height: CELL, ...SELECTED_STYLE }
                          : { width: CELL, height: CELL }
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-0 block rounded-[2px] transition-opacity duration-150",
                          day.level > 0 && "opacity-[var(--rq-cell-opacity)] group-hover:opacity-100",
                        )}
                        style={cellStyle(day)}
                      />
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5" aria-hidden="true">
        <span className="text-[11px]" style={{ color: "var(--rq-text-dim)" }}>
          Less
        </span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span
            key={level}
            className={cn("block rounded-[2px]", level > 0 && "opacity-[var(--rq-cell-opacity)]")}
            style={cellStyle({
              date: "",
              count: level,
              minutes: 0,
              titles: [],
              level,
              inRange: true,
            })}
          />
        ))}
        <span className="text-[11px]" style={{ color: "var(--rq-text-dim)" }}>
          More
        </span>
      </div>
    </div>
  );
}
