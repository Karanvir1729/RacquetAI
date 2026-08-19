import { useState } from "react";

/**
 * Hand-rolled SVG charts for the admin page. Single-series only, so the one
 * data hue is `--rq-data` and identity never rides on color; values surface
 * through a hover tooltip and the tables next to each chart. Marks follow the
 * house chart rules: thin bars, rounded data ends, 2px gaps, recessive grid.
 */

export interface DayPoint {
  day: string;
  count: number;
}

interface DailyBarsProps {
  points: DayPoint[];
  height?: number;
  ariaLabel: string;
}

export function DailyBars({ points, height = 140, ariaLabel }: DailyBarsProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { top: 14, right: 4, bottom: 20, left: 4 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.count));
  const step = innerW / Math.max(1, points.length);
  const barW = Math.max(3, step - 2);
  const hovered = hover !== null ? points[hover] : undefined;

  const first = points[0];
  const last = points[points.length - 1];

  // A chart that announces only its own title tells a screen-reader user
  // nothing — read out the shape of the series instead.
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const peak = points.reduce<DayPoint | undefined>(
    (best, point) => (best === undefined || point.count > best.count ? point : best),
    undefined,
  );
  const description =
    peak !== undefined && last !== undefined
      ? `${ariaLabel}. ${total} in total, peaking at ${peak.count} on ${peak.day}; most recently ${last.count} on ${last.day}.`
      : `${ariaLabel}. No data yet.`;

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={description}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        onMouseLeave={() => setHover(null)}
      >
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH - innerH * f}
            y2={pad.top + innerH - innerH * f}
            stroke="var(--rq-line)"
            strokeWidth={1}
          />
        ))}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + innerH}
          y2={pad.top + innerH}
          stroke="var(--rq-line-2)"
          strokeWidth={1}
        />
        {points.map((point, index) => {
          const h = point.count === 0 ? 0 : Math.max(2, (point.count / max) * innerH);
          return (
            <g key={point.day}>
              {/* invisible hit target, wider than the mark */}
              <rect
                x={pad.left + index * step}
                y={pad.top}
                width={step}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
              <rect
                x={pad.left + index * step + (step - barW) / 2}
                y={pad.top + innerH - h}
                width={barW}
                height={h}
                rx={2}
                fill="var(--rq-data)"
                opacity={hover === null || hover === index ? 1 : 0.45}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex justify-between">
        <span className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
          {first ? first.day.slice(5) : ""}
        </span>
        <span className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
          {last ? last.day.slice(5) : ""}
        </span>
      </div>

      {hovered !== undefined ? (
        <div
          className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-rq-sm border px-2.5 py-1"
          style={{
            borderColor: "var(--rq-line-2)",
            background: "var(--rq-panel)",
            color: "var(--rq-text)",
          }}
        >
          <span className="rq-caption">
            {hovered.day} · <strong>{hovered.count}</strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface CountRow {
  label: string;
  count: number;
}

/** Horizontal count bars — labels in ink, the bar carries only magnitude. */
export function CountBars({ rows }: { rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3">
          <span className="rq-caption truncate" style={{ color: "var(--rq-text-dim)" }}>
            {row.label}
          </span>
          <div className="h-3 rounded-full" style={{ background: "var(--rq-card-raised)" }}>
            <div
              className="h-3 rounded-full"
              style={{
                width: `${Math.max(2, (row.count / max) * 100)}%`,
                background: "var(--rq-data)",
              }}
            />
          </div>
          <span className="rq-num text-right text-[13px]" style={{ color: "var(--rq-text)" }}>
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Headline number tile. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-rq-md border p-5"
      style={{ borderColor: "var(--rq-line)", background: "var(--rq-card)" }}
    >
      <p className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
        {label}
      </p>
      <p className="rq-num mt-2 text-3xl font-extrabold" style={{ color: "var(--rq-text)" }}>
        {value}
      </p>
      {hint ? (
        <p className="rq-caption mt-1" style={{ color: "var(--rq-text-dim)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
