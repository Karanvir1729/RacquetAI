import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";

import { cn } from "@/lib/cn";

/**
 * A squash court in plan view, with a coverage heatmap painted on the floor.
 *
 * Court geometry is the real thing, in metres x10 so the viewBox is integral:
 * 6.4 m wide, 9.75 m long, short line 5.49 m from the front wall, 1.6 m service
 * boxes behind it. Row 0 of the heatmap is the front-wall end, matching the
 * contract in src/features/analysis/types.ts.
 *
 * The only motion is the floor filling in, back to front, once — it is the
 * reason the hero headline lights up (`onFilled`), the way a scoreboard comes
 * on when the numbers land. Reduced motion paints it immediately.
 */

const COURT_W = 64; // 6.4 m
const COURT_L = 97.5; // 9.75 m
const SHORT_LINE_Y = 54.9; // 5.49 m from the front wall
const BOX = 16; // 1.6 m service box

interface CourtPlanProps {
  rows: number;
  cols: number;
  /** Row-major, normalized 0..1. Length must be rows*cols; extra/short is tolerated. */
  values: readonly number[];
  className?: string;
  onFilled?: () => void;
  /**
   * A picture of the data, not a live chart: skip the staggered fill and the
   * forever-repeating T pulse. Set by DataPoster, where N of these tile a feed
   * and N never-ending animations is waste (and a distraction).
   */
  still?: boolean;
  /**
   * What the chart is, spoken. The default says nothing about WHERE the heat
   * sits, because that is the one thing this component cannot know — callers
   * with real data should pass a label derived from it.
   */
  ariaLabel?: string;
}

export function CourtPlan({
  rows,
  cols,
  values,
  className,
  onFilled,
  still = false,
  ariaLabel = "Court plan with the floor shaded where the player spent their time",
}: CourtPlanProps) {
  // A still poster and reduced-motion both mean "draw the end state, no motion".
  const reduced = useReducedMotion() || still;
  const cellW = COURT_W / cols;
  const cellH = COURT_L / rows;

  // The headline waits on the floor filling; if motion is off there is nothing
  // to wait for, so fire on mount.
  useEffect(() => {
    if (!onFilled) return;
    const wait = reduced ? 0 : 1250;
    const timer = window.setTimeout(onFilled, wait);
    return () => window.clearTimeout(timer);
  }, [onFilled, reduced]);

  return (
    <svg
      viewBox={`-2 -2 ${COURT_W + 4} ${COURT_L + 4}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Floor */}
      <rect
        x="0"
        y="0"
        width={COURT_W}
        height={COURT_L}
        rx="1.5"
        fill="var(--rq-court-floor)"
        stroke="var(--rq-line-2)"
        strokeWidth="0.5"
      />

      {/* Coverage — the data ink at the cell's own weight. Nothing else on the
          page fills an area with the accent, which is what makes this read as
          measurement rather than decoration. */}
      <g>
        {Array.from({ length: rows * cols }, (_, index) => {
          const raw = values[index] ?? 0;
          const weight = Math.max(0, Math.min(1, raw));
          if (weight < 0.005) return null;
          const row = Math.floor(index / cols);
          const col = index % cols;
          const opacity = 0.1 + weight * 0.62;
          return (
            <motion.rect
              key={index}
              x={col * cellW}
              y={row * cellH}
              width={cellW}
              height={cellH}
              fill="var(--rq-data)"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity }}
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      duration: 0.5,
                      // Back of the court fills first — that is where the play was.
                      delay: 0.25 + (rows - 1 - row) * 0.045,
                      ease: [0.22, 1, 0.36, 1],
                    }
              }
            />
          );
        })}
      </g>

      {/* Court markings — chalk lines over the heat */}
      <g stroke="var(--rq-court-line)" strokeWidth="0.55" fill="none" strokeLinecap="square">
        <line x1="0" y1={SHORT_LINE_Y} x2={COURT_W} y2={SHORT_LINE_Y} />
        <line x1={COURT_W / 2} y1={SHORT_LINE_Y} x2={COURT_W / 2} y2={COURT_L} />
        <rect x="0" y={SHORT_LINE_Y} width={BOX} height={BOX} />
        <rect x={COURT_W - BOX} y={SHORT_LINE_Y} width={BOX} height={BOX} />
      </g>

      {/* The T — the point every T-time percentage is measured against. */}
      <g>
        <circle cx={COURT_W / 2} cy={SHORT_LINE_Y} r="2.6" fill="var(--rq-data)" />
        {!reduced && (
          <motion.circle
            cx={COURT_W / 2}
            cy={SHORT_LINE_Y}
            r="2.6"
            fill="none"
            stroke="var(--rq-data)"
            strokeWidth="0.8"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: [1, 3.2], opacity: [0.6, 0] }}
            transition={{ duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeOut", delay: 1.4 }}
            style={{ transformOrigin: `${COURT_W / 2}px ${SHORT_LINE_Y}px` }}
          />
        )}
      </g>

      <text
        x={COURT_W / 2}
        y={COURT_L - 3}
        textAnchor="middle"
        fontSize="3.4"
        fontWeight="700"
        letterSpacing="0.6"
        fill="var(--rq-text-dim)"
      >
        BACK WALL
      </text>
      <text
        x={COURT_W / 2}
        y="5"
        textAnchor="middle"
        fontSize="3.4"
        fontWeight="700"
        letterSpacing="0.6"
        fill="var(--rq-text-dim)"
      >
        FRONT WALL
      </text>
    </svg>
  );
}
