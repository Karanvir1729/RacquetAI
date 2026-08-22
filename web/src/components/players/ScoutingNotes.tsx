import { MapPin, Tag } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Reveal } from "@/components/ui/Reveal";
import { MIN_SHOTS_FOR_NOTES, type ScoutingNote } from "@/players/aggregate";

/**
 * The scouting notes — the sentences a coach would write on the back of a
 * hand before a match. Each one is rule-based over the pooled numbers
 * (aggregate.ts holds the rules) and each carries its basis on its sleeve:
 * player POSITION and timing (coverage, the T, where the ball was
 * retrieved), which the pipeline measures, or shot CLASSES, which it reads
 * from body pose alone and has never audited. The chip is not decoration; it is the
 * difference between "they were rarely at the T" (measured) and "they go
 * cross-court a lot" (a reading), and a note that hid it would be claiming
 * more than the footage supports.
 *
 * Silence is a valid output. Under the minimum sample the rules say nothing,
 * and this says why rather than showing an empty box.
 */
export function ScoutingNotes({
  notes,
  totalShots,
  recordings,
}: {
  notes: readonly ScoutingNote[];
  totalShots: number;
  recordings: number;
}) {
  if (notes.length === 0) {
    const count = `${totalShots} ${totalShots === 1 ? "shot" : "shots"} across ${recordings} ${
      recordings === 1 ? "recording" : "recordings"
    }`;
    return (
      <Card className="p-5 sm:p-6">
        <p className="rq-label" style={{ color: "var(--rq-text)" }}>
          {totalShots < MIN_SHOTS_FOR_NOTES ? "Not enough footage yet" : "Nothing stands out yet"}
        </p>
        <p className="rq-caption mt-1.5">
          {totalShots < MIN_SHOTS_FOR_NOTES
            ? `${count}. Notes appear at ${MIN_SHOTS_FOR_NOTES}.`
            : `${count}, and no tendency clears the thresholds. That is a finding too — cover the middle.`}
        </p>
      </Card>
    );
  }

  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {notes.map((note, index) => (
        <li key={note.id}>
          <Reveal delay={index * 0.06} className="h-full">
            <Card className="flex h-full flex-col p-5 sm:p-6">
              <p className="rq-h4" style={{ color: "var(--rq-text)" }}>
                {note.title}
              </p>
              <p className="rq-caption mt-2 flex-1" style={{ fontSize: "var(--rq-fs-label)" }}>
                {note.detail}
              </p>
              <div className="mt-4">
                {note.basis === "position" ? (
                  <Chip icon={<MapPin className="h-3.5 w-3.5" />}>From position &amp; timing</Chip>
                ) : (
                  // The icon goes dim rather than accent: an indicative note
                  // should not carry the same mark as a measured one.
                  <Chip icon={<Tag className="h-3.5 w-3.5" style={{ color: "var(--rq-text-dim)" }} />}>
                    From shot classes · indicative
                  </Chip>
                )}
              </div>
            </Card>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}
