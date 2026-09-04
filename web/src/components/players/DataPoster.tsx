import type { ReactNode } from "react";

import { PlacementGrid } from "@/components/analysis/PlacementGrid";
import { CourtPlan } from "@/components/CourtPlan";
import type { ClipSummary } from "@/players/shape";

/**
 * The poster a recording gets when no frame travelled with it: a 16:9 box in
 * the court-floor colour with the clip's own court plan centred on it — the
 * same plan the read-out draws, over this one recording's coverage. A clip
 * tagged from a saved match (numbers, no footage) or before stills were kept
 * still has a face in the feed, and an honest one: it is drawn from the
 * measurements, and the corner label says so.
 *
 * With no coverage heatmap at all (a clip whose stored map did not parse) the
 * placement grid stands in — where the shots were retrieved is the next most
 * telling picture of the match.
 *
 * Pure presentation: nothing here reads state or fetches anything.
 */

/**
 * The small corner label on every poster — "Still" on a frame, "Court plan"
 * here — so a reader never has to guess which kind of picture they are
 * looking at. The same chip the player wears for "No pose track in this file".
 */
export function PosterLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="pointer-events-none absolute left-2.5 top-2.5 rounded-rq-sm border px-2 py-1 text-[11px] font-bold backdrop-blur-md"
      style={{
        borderColor: "var(--rq-line-2)",
        background: "var(--rq-chip)",
        color: "var(--rq-text)",
      }}
    >
      {children}
    </span>
  );
}

export function DataPoster({
  summary,
  title,
  className,
}: {
  summary: ClipSummary;
  /** The recording's title, for the plan's spoken label. */
  title: string;
  className?: string;
}) {
  const { me } = summary;
  const subject = title.length > 0 ? title : "this recording";

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "var(--rq-court-floor)",
        overflow: "hidden",
      }}
    >
      {me.coverage !== null ? (
        // The court is taller than it is wide and the box is the other way
        // round, so height is the constraint: 84% of the box, the width
        // follows from the court's own proportions, the rest is floor.
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ height: "84%", aspectRatio: "64 / 97.5" }}>
            <CourtPlan
            still
              rows={me.coverage.rows}
              cols={me.coverage.cols}
              values={me.coverage.values}
              ariaLabel={`Court plan of where ${me.label} spent their time in ${subject}`}
            />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div style={{ width: "min(100%, 13rem)" }}>
            <PlacementGrid placement={me.placement} />
          </div>
        </div>
      )}
      <PosterLabel>{me.coverage !== null ? "Court plan" : "Placement"}</PosterLabel>
    </div>
  );
}
