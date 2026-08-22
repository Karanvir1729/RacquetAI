import { ArrowUpRight, Upload } from "lucide-react";

import { formatClock } from "@/analysis/format";
import type { MatchAnalysis } from "@/analysis/types";
import { MatchPlayer } from "@/components/analysis/MatchPlayer";
import { PlayerPanel } from "@/components/analysis/PlayerPanel";
import { QualityFootnote } from "@/components/analysis/QualityFootnote";
import { PlayerTagControl } from "@/components/players/PlayerTagControl";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Reveal } from "@/components/ui/Reveal";
import type { ReactNode } from "react";

import { Section } from "@/components/ui/Section";
import { Stat } from "@/components/ui/Stat";
import type { ClipRef } from "@/players/shape";

/**
 * The read-out: one analysis, rendered whole.
 *
 * Order is deliberate. The video with the skeleton on it comes first because
 * it is the only part a player can check against their own memory of the
 * match — everything below is a summary of it, and a summary you cannot verify
 * is just an assertion. Then the match totals, then each player, then the
 * honesty footnote.
 *
 * Both `/analyze` and `/demo` end here; the demo passes the bundled sample and
 * a source note, a real job passes the server's analysis and its own video.
 * A `clipRef` — the ids a read-out can be tagged against — adds the "name this
 * player" control to each panel; the demo passes none, so it gets none.
 */
export function ResultsView({
  analysis,
  videoSrc,
  eyebrow,
  title,
  caption,
  action,
  clipRef,
  children,
}: {
  analysis: MatchAnalysis;
  videoSrc: string | null;
  eyebrow: string;
  title: string;
  /** Provenance line under the player. */
  caption?: string;
  action?: { to: string; label: string };
  /** What this read-out is, for tagging the people in it. Absent means no tagging (the demo). */
  clipRef?: ClipRef;
  /** Extra panels below the read-out — the video referee, when footage is local. */
  children?: ReactNode;
}) {
  const { video, rallies, shots, players, quality } = analysis;

  return (
    <>
      <Section divider={false}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="rq-eyebrow">{eyebrow}</p>
            <h1 className="rq-h2 mt-3">{title}</h1>
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip>{formatClock(video.durationSec)} of footage</Chip>
              <Chip>
                {video.width}×{video.height} · {video.fps.toFixed(2)} fps
              </Chip>
              <Chip>
                {analysis.tracks === undefined
                  ? `Schema v${analysis.schemaVersion} · no pose track`
                  : `Schema v${analysis.schemaVersion} · ${analysis.tracks.length} pose samples`}
              </Chip>
            </div>
          </div>
          {action !== undefined ? (
            <ButtonLink to={action.to} variant="outline" size="md">
              <Upload className="h-4 w-4" /> {action.label}
            </ButtonLink>
          ) : null}
        </div>

        <div className="mt-9">
          <MatchPlayer analysis={analysis} videoSrc={videoSrc} caption={caption} />
        </div>

        {/* Match totals ride in the same band as the video: they describe the
            thing you just watched, and a section break between them would
            imply a change of subject. */}
        <Card className="mt-6 p-5 sm:p-7">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Shots detected" value={shots.length} hint="Across both players" />
            <Stat label="Rallies" value={rallies.count} hint="Sound and motion boundaries" />
            {/* Labels are kept to one line at 375px on purpose: a wrapped
                label in one cell drops that cell's number below its
                neighbour's and the row stops reading as a row. */}
            <Stat
              label="Avg rally"
              value={rallies.avgShotsPerRally.toFixed(1)}
              unit="shots"
              hint="Mean over the match"
            />
            <Stat
              label="Longest rally"
              value={rallies.longestRally}
              unit="shots"
              hint="Longest single exchange"
            />
          </div>
        </Card>
      </Section>

      <Section tone="panel">
        <div className="grid gap-6 xl:grid-cols-2">
          {players.map((player, index) => (
            <Reveal key={player.id} delay={index * 0.08}>
              <PlayerPanel
                player={player}
                shots={shots}
                headerExtra={
                  clipRef === undefined ? undefined : (
                    <PlayerTagControl side={player.id} clipRef={clipRef} analysis={analysis} />
                  )
                }
              />
            </Reveal>
          ))}
        </div>

        {children}

        <div className="mt-6">
          <QualityFootnote quality={quality} />
        </div>

        <p className="rq-caption mt-6 break-words">
          Source: {video.source} · {video.license}
        </p>

        <div className="mt-10">
          <ButtonLink to="/#limits" variant="ghost" size="sm">
            What this can and cannot measure <ArrowUpRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
