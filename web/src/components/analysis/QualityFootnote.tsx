import { Info } from "lucide-react";

import { formatCount, formatPercent } from "@/analysis/format";
import type { AnalysisQuality } from "@/analysis/types";
import { Card } from "@/components/ui/Card";

/**
 * The small print, ported in spirit from the app's QualityFootnote: how much
 * footage was actually measured, the audio caveat when rally boundaries had no
 * sound to lean on, and whatever notes the pipeline attached.
 *
 * It also carries the two limits that are true of every RacketIQ analysis and
 * are easy to forget once you are looking at a page of confident numbers: shot
 * detection was audited at 63% precision, and shot classes come from body pose
 * on 854-pixel-wide footage with no ball tracking, so many of them are not
 * verifiable at all. Printing that beside the charts is the whole point of
 * having a footnote.
 */
export function QualityFootnote({ quality }: { quality: AnalysisQuality }) {
  const lines: string[] = [
    `Based on ${formatCount(quality.framesAnalyzed)} analyzed frames · both players detected in ${formatPercent(
      quality.bothPlayersDetectedPct / 100,
    )} of them.`,
  ];
  if (!quality.audioAvailable) {
    lines.push("No audio track — shot and rally boundaries are estimated from motion alone.");
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0" style={{ color: "var(--rq-accent-text)" }}>
          <Info className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="rq-label" style={{ color: "var(--rq-text)" }}>
            How much to trust this
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {lines.concat(quality.notes).map((line) => (
              <li key={line} className="rq-caption">
                {line}
              </li>
            ))}
            <li className="rq-caption">
              Shot detection was audited at 63% precision on club-grade footage — expect some
              phantom shots and some misses in the counts above.
            </li>
            <li className="rq-caption">
              Shot classes are inferred from body pose alone, with no ball tracking. At this
              resolution many are genuinely unverifiable; treat the mix as indicative, not as a
              record of what was hit.
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}
