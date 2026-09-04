import type { TrendPoint } from "@/players/aggregate";

/**
 * One metric across a player's recordings, as a line small enough to sit in a
 * card corner. Hand-drawn SVG: a polyline and a dot on the last point, no
 * chart library, because the question it answers is only "up, down or flat
 * since the first clip" and axes would dress that up as more.
 *
 * The y-range is the data's own (with a floor so a flat line draws in the
 * middle, not on the edge), which exaggerates small movements — so the first
 * and last values are printed beside it, and the aria-label says the same
 * thing. Below three points there is no trend to speak of and it renders
 * nothing; the caller decides whether to say why.
 */

export type TrendMetric = "tTimePct" | "predictability";

const WIDTH = 240;
const HEIGHT = 48;
const PAD = 4;

function formatValue(metric: TrendMetric, value: number): string {
  // Both read as percentages on the stat tiles and the read-out; the chart says the same.
  return metric === "tTimePct" ? `${Math.round(value)}%` : `${Math.round(value * 100)}%`;
}

export function TrendSparkline({
  points,
  metric,
  label,
}: {
  /** Chronological, oldest first — `ProfileStats.trend` as it comes. */
  points: readonly TrendPoint[];
  metric: TrendMetric;
  /** What the line is, spoken and printed — "Time at the T". */
  label: string;
}) {
  if (points.length < 3) return null;

  const values = points.map((point) => point[metric]);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat line still needs a span to divide by; a unit of the metric's own
  // scale keeps it in the middle of the box rather than along the bottom.
  const span = max - min > 0 ? max - min : metric === "tTimePct" ? 1 : 0.01;
  const innerW = WIDTH - PAD * 2;
  const innerH = HEIGHT - PAD * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  const coords = values.map((value, index) => {
    const x = PAD + index * step;
    const y = PAD + innerH - ((value - min) / span) * innerH;
    return [x, y] as const;
  });
  const lastPoint = coords[coords.length - 1] ?? [PAD, HEIGHT / 2];
  const spoken = `${label}: ${formatValue(metric, first)} on the first recording to ${formatValue(
    metric,
    last,
  )} on the latest, over ${points.length} recordings`;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="rq-micro-label">{label}</p>
        <p className="rq-num text-[13px]" style={{ color: "var(--rq-text-dim)" }}>
          {formatValue(metric, first)} → {formatValue(metric, last)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="mt-2 block h-auto max-w-full"
        role="img"
        aria-label={spoken}
      >
        <polyline
          points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--rq-data)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={lastPoint[0]} cy={lastPoint[1]} r="3.5" fill="var(--rq-data)" />
      </svg>
    </div>
  );
}
