import { formatPercent, prettyPattern } from "@/analysis/format";
import { countShotTypes } from "@/analysis/shots";
import type { PlayerAnalysis, ShotEvent } from "@/analysis/types";
import { PlacementGrid } from "@/components/analysis/PlacementGrid";
import { ShotTypeBars } from "@/components/analysis/ShotTypeBars";
import { CourtPlan } from "@/components/CourtPlan";
import { Card, Hairline } from "@/components/ui/Card";
import { Meter, Stat } from "@/components/ui/Stat";

/**
 * Everything measured about one player, in one card: coverage on the court
 * plan, T-time, predictability, the shot mix and the placement quadrants.
 *
 * Two players means two of these side by side, which is the point — almost
 * every number here is only interesting next to the other player's. Player A
 * is drawn in the accent and player B in chalk, matching the skeleton colours
 * in the video above so a figure on screen and a column of numbers are
 * obviously the same person.
 */
export function PlayerPanel({
  player,
  shots,
}: {
  player: PlayerAnalysis;
  shots: readonly ShotEvent[];
}) {
  const counts = countShotTypes(shots, player.id);
  const { predictability, coverageHeatmap } = player;

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: player.id === "A" ? "var(--rq-data)" : "var(--rq-text)" }}
          />
          <h3 className="rq-h3">{player.label}</h3>
        </div>
        <p className="rq-num text-[13px]" style={{ color: "var(--rq-text-dim)" }}>
          {player.shots} shots
        </p>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        {/* Coverage. Same court plan the landing hero uses, on this player's
            own heatmap — the site has exactly one way of drawing a court. */}
        <div>
          <p
            className="text-[11px] font-extrabold uppercase"
            style={{ letterSpacing: "0.14em", color: "var(--rq-text-faint)" }}
          >
            Coverage
          </p>
          <div className="mt-3 flex justify-center">
            <div style={{ height: "clamp(220px, 40vw, 300px)", aspectRatio: "64 / 97.5" }}>
              <CourtPlan
                rows={coverageHeatmap.rows}
                cols={coverageHeatmap.cols}
                values={coverageHeatmap.values}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Stat
                label="T-time"
                value={player.tTimePct.toFixed(1)}
                unit="%"
                hint="Frames within 1.5 m of the T"
              />
              <Meter value={player.tTimePct / 100} label={`${player.label} T-time`} />
            </div>
            <div>
              <Stat
                label="Predictability"
                value={formatPercent(predictability.score)}
                hint="Higher means easier to read"
              />
              <Meter
                value={predictability.score}
                label={`${player.label} predictability`}
              />
            </div>
          </div>

          <div>
            <p className="text-[13px]" style={{ color: "var(--rq-text)" }}>
              Most common pattern: {prettyPattern(predictability.topPattern)}
            </p>
            <p className="rq-caption mt-1">
              Shot-choice entropy {predictability.entropyBits.toFixed(1)} of{" "}
              {predictability.maxEntropyBits.toFixed(1)} bits — lower means easier to read.
            </p>
          </div>

          <div>
            <p
              className="text-[11px] font-extrabold uppercase"
              style={{ letterSpacing: "0.14em", color: "var(--rq-text-faint)" }}
            >
              Where the shots landed
            </p>
            <div className="mt-3">
              <PlacementGrid placement={player.placement} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Hairline />
      </div>

      <div className="mt-6">
        <p
          className="text-[11px] font-extrabold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--rq-text-faint)" }}
        >
          Shot mix
        </p>
        <div className="mt-3">
          <ShotTypeBars counts={counts} />
        </div>
      </div>
    </Card>
  );
}
