import { useEffect, useMemo, useRef } from "react";

import { formatIsoDay } from "@/components/players/ContributionGrid";
import { Card } from "@/components/ui/Card";
import { movementProfile, type RegionShares } from "@/players/aggregate";
import type { PlayerClip } from "@/players/shape";

/**
 * Court movement across recordings — the "meta" view the pooled court plan
 * cannot give. The plan says where a player lived over everything; this says
 * whether that moved: one stacked bar per recording, oldest on the left, and
 * a pooled bar last, on two axes. Depth stacks front at the TOP and back at
 * the bottom, mirroring the court plan beside it (row 0 of the heatmap is
 * the front wall); width runs left to right as the camera sees the court.
 *
 * Hand-drawn SVG, like the trend sparkline: the question is "has their game
 * drifted deeper / to one side, and how much court do they use" and a chart
 * library would dress three numbers per clip up as more. Every number here
 * is read off player POSITION (the per-clip coverage map) — measured, not
 * inferred — and the captions say so. The maths is `movementProfile` in
 * players/aggregate.ts; this file only paints.
 *
 * Series are one data ink at three opacities (0.95 / 0.6 / 0.3), the same
 * ramp the calendar uses for its levels, so the page stays one colour.
 */

const BAR_W = 24;
const BAR_GAP = 10;
const BAR_H = 72;
/** Extra room before the pooled bar, so "All" reads as a summary, not one more recording. */
const POOL_GAP = 14;
const LABEL_H = 16;
const PAD_X = 2;
const DEPTH_SERIES = [
  { key: "front", word: "Front", opacity: 0.95 },
  { key: "middle", word: "Middle", opacity: 0.6 },
  { key: "back", word: "Back", opacity: 0.3 },
] as const;
const WIDTH_SERIES = [
  { key: "left", word: "Left", opacity: 0.95 },
  { key: "centre", word: "Centre", opacity: 0.6 },
  { key: "right", word: "Right", opacity: 0.3 },
] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-13" → "13 Aug" — the x-axis has no room for the year; the tooltip carries it. */
function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (month === undefined || !Number.isFinite(day)) return iso;
  return `${day} ${month}`;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function depthWords(s: RegionShares): string {
  return `front ${pct(s.front)} · middle ${pct(s.middle)} · back ${pct(s.back)}`;
}

function widthWords(s: RegionShares): string {
  return `left ${pct(s.left)} · centre ${pct(s.centre)} · right ${pct(s.right)}`;
}

function recordingsWord(count: number): string {
  return `${count} ${count === 1 ? "recording" : "recordings"}`;
}

/** One bar on either axis — a recording, or the pooled "All". */
interface Bar {
  key: string;
  /** Under the bar: "13 Aug" or "All". */
  label: string;
  /** Starts the tooltip: "13 Aug 2026 — Title" or "All 4 recordings". */
  name: string;
  shares: RegionShares;
}

function Legend({ series }: { series: readonly { word: string; opacity: number }[] }) {
  return (
    <p
      aria-hidden="true"
      className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold"
      style={{ color: "var(--rq-text-dim)" }}
    >
      {series.map((item, index) => (
        <span key={item.word} className="inline-flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: "var(--rq-data)", opacity: item.opacity }}
          />
          {item.word}
        </span>
      ))}
    </p>
  );
}

export function MovementChart({ clips }: { clips: readonly PlayerClip[] }) {
  const profile = useMemo(() => movementProfile(clips), [clips]);
  const scroller = useRef<HTMLDivElement | null>(null);

  // Open on the recent end, like the calendar: the latest recordings and the
  // pooled bar are what a coach reads first. `scrollLeft` past the max clamps.
  useEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollLeft = node.scrollWidth;
  }, [profile]);

  const { points, pooled, clipsWithoutCoverage } = profile;

  if (pooled === null || points.length === 0) {
    return <p className="rq-caption">No coverage maps on these recordings yet.</p>;
  }

  const bars: Bar[] = [
    ...points.map((point) => ({
      key: point.clipId,
      label: shortDate(point.playedAt),
      name: `${formatIsoDay(point.playedAt)} — ${point.title.length > 0 ? point.title : "Untitled recording"}`,
      shares: point,
    })),
    { key: "all", label: "All", name: `All ${recordingsWord(points.length)}`, shares: pooled },
  ];
  const count = bars.length;
  const width = PAD_X * 2 + count * BAR_W + (count - 1) * BAR_GAP + POOL_GAP;
  const height = BAR_H + LABEL_H;
  const barX = (index: number) => PAD_X + index * (BAR_W + BAR_GAP) + (index === count - 1 ? POOL_GAP : 0);
  // A hairline in the widened gap, between the last recording and "All".
  const dividerX = barX(count - 1) - (BAR_GAP + POOL_GAP) / 2;

  const over = `pooled over ${recordingsWord(points.length)}`;
  const depthSpoken = `Depth, ${over}: ${depthWords(pooled)}. One bar per recording, oldest on the left, the pooled bar last; front at the top.`;
  const widthSpoken = `Width, ${over}: ${widthWords(pooled)}. One bar per recording, oldest first, the pooled bar last.`;

  return (
    <Card className="p-5 sm:p-7">
      <p className="rq-micro-label">Court movement across recordings</p>
      <p className="rq-caption mt-1.5">
        Where their time on court went, recording by recording, from player position. Top = front
        wall.
      </p>

      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-8">
        {/* Depth: vertical stacks, front at the top like the court plan. The
            SVG draws at 1:1 — four bars do not stretch across a desktop — and
            with many recordings it scrolls inside its own box, opened at the
            recent end, like the calendar; the page never widens. */}
        <div className="min-w-0 max-w-full flex-none">
          <p className="rq-label" style={{ color: "var(--rq-text)" }}>
            Depth
          </p>
          <div ref={scroller} className="mt-3 overflow-x-auto pb-1">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              className="block"
              role="img"
              aria-label={depthSpoken}
            >
              {bars.map((bar, index) => {
                const x = barX(index);
                let y = 0;
                return (
                  <g key={bar.key}>
                    <title>{`${bar.name} — ${depthWords(bar.shares)} · court used ${pct(bar.shares.spread)}`}</title>
                    {DEPTH_SERIES.map((series) => {
                      const h = bar.shares[series.key] * BAR_H;
                      const top = y;
                      y += h;
                      return (
                        <rect
                          key={series.key}
                          x={x}
                          y={top.toFixed(2)}
                          width={BAR_W}
                          height={h.toFixed(2)}
                          fill="var(--rq-data)"
                          opacity={series.opacity}
                        />
                      );
                    })}
                    <text
                      x={x + BAR_W / 2}
                      y={BAR_H + 12}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="600"
                      fill="var(--rq-text-dim)"
                      className="rq-num"
                    >
                      {bar.label}
                    </text>
                  </g>
                );
              })}
              <line x1={dividerX} x2={dividerX} y1={0} y2={BAR_H} stroke="var(--rq-line)" strokeWidth="1" />
            </svg>
          </div>
          <Legend series={DEPTH_SERIES} />
        </div>

        {/* Width: one horizontal stack per recording, left to right as the
            camera sees the court, full width so the split is legible. */}
        <div className="min-w-[16rem] flex-1">
          <p className="rq-label" style={{ color: "var(--rq-text)" }}>
            Width
          </p>
          {/* role="img": one picture of several rows; the per-row numbers are
              in the hidden list below (a <ul> may not carry the img role). */}
          <div className="mt-3 flex flex-col gap-2" role="img" aria-label={widthSpoken}>
            {bars.map((bar, index) => {
              let x = 0;
              return (
                <div
                  key={bar.key}
                  className={index === count - 1 ? "mt-1.5 flex items-center gap-3" : "flex items-center gap-3"}
                >
                  <span
                    className="rq-num w-12 shrink-0 text-[10px] font-semibold"
                    style={{ color: "var(--rq-text-dim)" }}
                  >
                    {bar.label}
                  </span>
                  <svg
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                    width="100%"
                    height="10"
                    className="block min-w-0 flex-1 overflow-hidden rounded-[2px]"
                  >
                    <title>{`${bar.name} — ${widthWords(bar.shares)}`}</title>
                    {WIDTH_SERIES.map((series) => {
                      const w = bar.shares[series.key] * 100;
                      const left = x;
                      x += w;
                      return (
                        <rect
                          key={series.key}
                          x={left.toFixed(2)}
                          y={0}
                          width={w.toFixed(2)}
                          height={10}
                          fill="var(--rq-data)"
                          opacity={series.opacity}
                        />
                      );
                    })}
                  </svg>
                </div>
              );
            })}
          </div>
          <Legend series={WIDTH_SERIES} />
        </div>
      </div>

      <p className="rq-caption rq-num mt-6 max-w-3xl">
        Pooled over {recordingsWord(points.length)}: {pct(pooled.front)} front · {pct(pooled.middle)}{" "}
        middle · {pct(pooled.back)} back; {pct(pooled.left)} left · {pct(pooled.centre)} centre ·{" "}
        {pct(pooled.right)} right. They used {pct(pooled.spread)} of the court (cells with at least a
        tenth of their busiest cell&apos;s time).
        {clipsWithoutCoverage > 0
          ? ` ${recordingsWord(clipsWithoutCoverage)} carried no coverage map and ${
              clipsWithoutCoverage === 1 ? "is" : "are"
            } not in this chart.`
          : ""}
      </p>

      {/* The per-recording numbers, spoken: the bars are pictures. */}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.clipId}>
            {formatIsoDay(point.playedAt)} — {point.title.length > 0 ? point.title : "Untitled recording"} —{" "}
            {depthWords(point)}; {widthWords(point)}; court used {pct(point.spread)}.
          </li>
        ))}
      </ul>
    </Card>
  );
}
