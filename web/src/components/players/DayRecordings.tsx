import { ArrowDown, ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { formatClock, formatPercent } from "@/analysis/format";
import { formatIsoDay } from "@/components/players/ContributionGrid";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { PlayerClip } from "@/players/shape";

/**
 * What a calendar cell opens: the recordings played on that day, one row
 * each, with the same figures the recordings list prints so the two agree
 * line for line. It sits under the grid in the grid's own card — the cell
 * you pressed is still in view above it — and closes on Escape, on its X,
 * or by pressing the same cell again (the grid's job).
 *
 * Focus moves to the heading when the panel opens or the day changes, so a
 * keyboard user (or a screen reader) lands on the answer rather than having
 * to hunt for it; closing hands focus back to the cell (the grid's job too).
 *
 * Two ways out of a row: "Open in library" only for a recording whose
 * analysis is in THIS browser — the profile holds a summary, never the
 * footage, so a row from another machine cannot open anything here — and
 * "Show in list", which scrolls the recordings feed to that clip's card
 * (ClipFeed gives each `id="clip-<id>"`), where the edits (re-date, untag)
 * and "Show detailed analysis" live.
 */

export function DayRecordings({
  date,
  clips,
  libraryIds,
  onClose,
  onShowInList,
}: {
  /** YYYY-MM-DD — the open day. */
  date: string;
  /** That day's clips, as `clipsOnDay` returns them. */
  clips: readonly PlayerClip[];
  /** History ids present in THIS browser — the only ones "Open in library" can honour. */
  libraryIds?: ReadonlySet<string>;
  onClose: () => void;
  /** Scroll the recordings feed to this clip's card (`#clip-<id>`) and point at it. */
  onShowInList?: (clipId: string) => void;
}) {
  const heading = useRef<HTMLParagraphElement | null>(null);
  const when = formatIsoDay(date);

  useEffect(() => {
    heading.current?.focus();
  }, [date]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const title =
    clips.length === 0
      ? `No recordings on ${when}`
      : `${when} — ${clips.length} ${clips.length === 1 ? "recording" : "recordings"}`;

  return (
    <div role="region" aria-label={`Recordings on ${when}`} onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-4">
        {/* tabIndex -1: focusable by script (the effect above), not a tab stop. */}
        <p ref={heading} tabIndex={-1} className="rq-micro-label rq-num min-w-0">
          {title}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-rq-sm border transition-colors"
          style={{ borderColor: "var(--rq-line)", color: "var(--rq-text-dim)" }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {clips.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-4">
          {clips.map((clip) => {
            const { me, opponent } = clip.summary;
            const inLibrary =
              clip.historyId !== null && libraryIds !== undefined && libraryIds.has(clip.historyId);
            return (
              <li key={clip.id} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-[15px] font-semibold text-rq-text">
                    {clip.title.length > 0 ? clip.title : "Untitled recording"}
                  </p>
                  <p className="rq-caption rq-num mt-1">
                    as {me.label} · {formatClock(clip.durationSec)} · {clip.shots}{" "}
                    {clip.shots === 1 ? "shot" : "shots"}
                  </p>
                  <p className="rq-caption rq-num mt-0.5">
                    T-time {me.tTimePct.toFixed(0)}% · predictability {formatPercent(me.predictability.score)}
                    {opponent !== null ? ` · opponent T-time ${opponent.tTimePct.toFixed(0)}%` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {inLibrary && clip.historyId !== null ? (
                    <ButtonLink to={`/library?match=${clip.historyId}`} variant="outline" size="sm">
                      Open in library <ArrowUpRight className="h-4 w-4" />
                    </ButtonLink>
                  ) : null}
                  {onShowInList !== undefined ? (
                    <Button variant="ghost" size="sm" onClick={() => onShowInList(clip.id)}>
                      Show in list <ArrowDown className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
