import { CourtPlan } from "@/components/CourtPlan";
import { Card, Hairline } from "@/components/ui/Card";
import { Meter, Stat } from "@/components/ui/Stat";
import { HERO_HEATMAP, HERO_MATCH, HERO_PLAYER } from "@/data/heroMatch";

/**
 * The hero centrepiece: one real analysis, shown as the product shows it.
 *
 * RacquetIQ's brand has no mascot (docs/04-branding.md: "the mark is geometry,
 * not illustration"), so where Daybot puts a character, this puts the artefact
 * the product actually makes — a court plan with real coverage on it and the
 * read-outs beside it. Every number comes from HERO_MATCH / HERO_PLAYER, which
 * are copied out of a real analysis.json.
 */
export function HeroPlate({ onFilled }: { onFilled?: () => void }) {
  const placement = HERO_PLAYER.placement;
  const placementTotal =
    placement.frontLeft + placement.frontRight + placement.backLeft + placement.backRight;
  const cells = [
    { key: "Front L", value: placement.frontLeft },
    { key: "Front R", value: placement.frontRight },
    { key: "Back L", value: placement.backLeft },
    { key: "Back R", value: placement.backRight },
  ];
  const busiest = Math.max(...cells.map((cell) => cell.value));

  return (
    <div className="relative w-full">
      <Card className="overflow-hidden p-3 sm:p-4" style={{ boxShadow: "var(--rq-lift-shadow)" }}>
        {/* Plate header — says what this is before anyone reads a number. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 pb-3 pt-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="inline-flex h-2 w-2 shrink-0 rounded-full"
              style={{ background: "var(--rq-data)" }}
            />
            <p className="truncate text-[13px] font-bold" style={{ color: "var(--rq-text)" }}>
              {HERO_PLAYER.label} · coverage
            </p>
          </div>
          <p className="rq-num text-[12.5px]" style={{ color: "var(--rq-text-dim)" }}>
            {HERO_MATCH.durationLabel} of match footage · {HERO_MATCH.shots} shots detected
          </p>
        </div>

        <Hairline />

        <div className="grid gap-4 pt-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] sm:gap-5">
          {/* Court. Height-driven with a fixed aspect ratio so the plan never
              floats inside a wider box with dead bands down its sides. */}
          <div className="flex items-center justify-center py-1">
            <div
              className="h-full"
              style={{ height: "clamp(230px, 34vw, 330px)", aspectRatio: "64 / 97.5" }}
            >
              <CourtPlan
                rows={HERO_HEATMAP.rows}
                cols={HERO_HEATMAP.cols}
                values={HERO_HEATMAP.values}
                onFilled={onFilled}
              />
            </div>
          </div>

          {/* Read-outs */}
          <div className="flex flex-col justify-between gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Stat
                  label="T-time"
                  value={HERO_PLAYER.tTimePct.toFixed(1)}
                  unit="%"
                  hint="Frames within 1.5 m of the T"
                />
                <Meter value={HERO_PLAYER.tTimePct / 100} label="T-time" />
              </div>
              <div>
                <Stat
                  label="Predictability"
                  value={HERO_PLAYER.predictability.toFixed(2)}
                  hint={HERO_PLAYER.topPattern}
                />
                <Meter value={HERO_PLAYER.predictability} label="Predictability" />
              </div>
            </div>

            <div>
              <p className="rq-micro-label">Where the shots landed</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {cells.map((cell) => {
                  const share = busiest > 0 ? cell.value / busiest : 0;
                  return (
                    <div
                      key={cell.key}
                      className="rounded-rq-sm border px-3 py-2.5"
                      style={{
                        borderColor: "var(--rq-line)",
                        background: `color-mix(in srgb, var(--rq-data) ${Math.round(share * 16)}%, transparent)`,
                      }}
                    >
                      <p className="text-[11px] font-semibold" style={{ color: "var(--rq-text-dim)" }}>
                        {cell.key}
                      </p>
                      <p className="rq-num text-[19px] font-extrabold leading-tight">
                        {cell.value}
                        <span
                          className="ml-1 text-[11px] font-semibold"
                          style={{ color: "var(--rq-text-dim)" }}
                        >
                          {placementTotal > 0
                            ? `${Math.round((cell.value / placementTotal) * 100)}%`
                            : ""}
                        </span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="rq-caption">
              Real output from {HERO_MATCH.resolution} footage ({HERO_MATCH.license}). Shot
              detection is approximate — see the limits below.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
