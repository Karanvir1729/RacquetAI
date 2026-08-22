import { ArrowUpRight, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatClock, formatPercent } from "@/analysis/format";
import { formatIsoDay } from "@/components/players/ContributionGrid";
import { DataPoster, PosterLabel } from "@/components/players/DataPoster";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { isIsoDay, type PlayerClip } from "@/players/shape";
import { mediaUrl } from "@/players/store";

/**
 * The recordings as a feed: one card per clip, newest first, a poster on top
 * and the clip's own figures under it — the shape of a video feed, because
 * "which match was that" is answered by a picture long before it is answered
 * by a title.
 *
 * What the poster is depends on what travelled with the tag. A frame — the
 * one still captured in the browser that had the footage (players/poster.ts)
 * — when there is one; otherwise the clip's court plan, drawn from its stored
 * coverage. Each carries a corner label saying which, and the alt text on a
 * frame says "still", never "video": the footage stayed where it was analysed.
 *
 * "Show detailed analysis" goes to the fullest read-out that exists for this
 * clip on THIS machine: the library entry if the analysis is in this browser
 * (with the video, while the Analyze tab that uploaded it is open), else the
 * stored analysis page (pose track stripped, poster in place of the video),
 * else nowhere — a clip tagged before analyses were kept has only its summary,
 * and the card says so rather than offering a button that opens nothing.
 *
 * The owner's edits (re-date, untag) sit in a second row on the card, the
 * same controls the old list had; read-only profiles get the cards without
 * them. Each card root carries `id="clip-<id>"` and `tabIndex={-1}` so the
 * calendar's day panel can scroll to it and hand it focus, and `flashClipId`
 * outlines the card it just pointed at.
 */

export interface ClipFeedProps {
  /** Newest first — the caller sorts; the feed draws in the order given. */
  clips: readonly PlayerClip[];
  /** Whose feed this is — for the remove control's spoken label and its confirm copy. */
  playerName: string;
  /** Where this profile lives ("/players/<id>", "/players/sample", "/p/<token>") — the stored read-out is under it. */
  basePath: string;
  /** History ids present in THIS browser — the only ones the library can open. */
  libraryIds?: ReadonlySet<string>;
  readOnly?: boolean;
  onRedate?: (clipId: string, playedAt: string) => Promise<void> | void;
  onUntag?: (clipId: string) => Promise<void> | void;
  /** The card to outline for a moment — the one "Show in list" just pointed at. */
  flashClipId?: string | null;
  /** The card whose edit is in flight; its controls wait. */
  busyClipId?: string | null;
}

/**
 * A date worth saving. `<input type="date">` fires change on every complete
 * value as the year is typed — "0002-08-21", "0020-08-21" — and each would
 * otherwise round-trip to the server. Nothing was filmed before the pipeline
 * existed, so anything earlier than this century is a keystroke, not a date.
 */
export function isPlausibleDay(value: string): boolean {
  return isIsoDay(value) && value >= "2000-01-01";
}

const INPUT_STYLE = {
  borderColor: "var(--rq-line-2)",
  background: "var(--rq-input)",
  color: "var(--rq-text)",
} as const;

export function ClipFeed({
  clips,
  playerName,
  basePath,
  libraryIds,
  readOnly = false,
  onRedate,
  onUntag,
  flashClipId = null,
  busyClipId = null,
}: ClipFeedProps) {
  // One-click confirm for "remove", owned here: the feed is the only place
  // the control lives, and a card that unmounts (the untag landed) takes its
  // open confirm with it.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (clips.length === 0) return null;

  const remove = async (clipId: string) => {
    if (onUntag === undefined) return;
    await onUntag(clipId);
    setConfirmId(null);
  };

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Recordings of ${playerName}`}>
      {clips.map((clip) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          playerName={playerName}
          basePath={basePath}
          inLibrary={clip.historyId !== null && libraryIds !== undefined && libraryIds.has(clip.historyId)}
          readOnly={readOnly}
          onRedate={onRedate}
          onUntag={onUntag === undefined ? undefined : remove}
          flashing={flashClipId === clip.id}
          working={busyClipId === clip.id}
          confirming={confirmId === clip.id}
          onConfirm={(open) => setConfirmId(open ? clip.id : null)}
        />
      ))}
    </ul>
  );
}

function ClipCard({
  clip,
  playerName,
  basePath,
  inLibrary,
  readOnly,
  onRedate,
  onUntag,
  flashing,
  working,
  confirming,
  onConfirm,
}: {
  clip: PlayerClip;
  playerName: string;
  basePath: string;
  inLibrary: boolean;
  readOnly: boolean;
  onRedate?: (clipId: string, playedAt: string) => Promise<void> | void;
  onUntag?: (clipId: string) => Promise<void> | void;
  flashing: boolean;
  working: boolean;
  confirming: boolean;
  onConfirm: (open: boolean) => void;
}) {
  // A poster path whose object is gone (bucket emptied, a stale row) draws
  // the court plan instead of a broken-image glyph.
  const [posterBroken, setPosterBroken] = useState(false);
  // The trash button unmounts when the confirm opens, so focus would fall to
  // <body>. Move it onto the confirm's Remove button, and back is handled by
  // the button remounting where the user left it.
  const confirmRemoveRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (confirming) confirmRemoveRef.current?.focus();
  }, [confirming]);
  const { me, opponent } = clip.summary;
  const title = clip.title.length > 0 ? clip.title : "Untitled recording";
  const poster = clip.posterPath !== null && !posterBroken ? mediaUrl(clip.posterPath) : null;

  // The fullest read-out there is for this clip, here, in order of fullness.
  const detail: { to: string } | null =
    inLibrary && clip.historyId !== null
      ? { to: `/library?match=${clip.historyId}` }
      : clip.analysisPath !== null
        ? { to: `${basePath}/clips/${clip.id}` }
        : null;

  const showOwnerRow = !readOnly && (onRedate !== undefined || onUntag !== undefined);

  return (
    // id + tabIndex -1: "Show in list" on the calendar panel scrolls here and
    // hands the card focus.
    <li id={`clip-${clip.id}`} tabIndex={-1} className="min-w-0 rounded-rq-lg">
      <Card
        className="flex h-full flex-col overflow-hidden"
        style={flashing ? { outline: "2px solid var(--rq-accent-text)", outlineOffset: 2 } : undefined}
      >
        <div className="relative">
          {poster !== null ? (
            <div
              className="relative w-full overflow-hidden"
              style={{ aspectRatio: "16 / 9", background: "var(--rq-court-floor)" }}
            >
              <img
                src={poster}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setPosterBroken(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <PosterLabel>Still</PosterLabel>
            </div>
          ) : (
            <DataPoster summary={clip.summary} title={clip.title} />
          )}
          <span
            className="rq-num pointer-events-none absolute bottom-2.5 right-2.5 rounded-rq-sm border px-2 py-1 text-[11px] font-bold backdrop-blur-md"
            style={{
              borderColor: "var(--rq-line-2)",
              background: "var(--rq-chip)",
              color: "var(--rq-text)",
            }}
          >
            {formatClock(clip.durationSec)}
          </span>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <p className="truncate text-[15px] font-semibold text-rq-text" title={title}>
            {title}
          </p>
          <p className="rq-caption rq-num mt-1">
            {formatIsoDay(clip.playedAt)} · as {me.label} · {clip.shots}{" "}
            {clip.shots === 1 ? "shot" : "shots"}
          </p>
          <p className="rq-caption rq-num mt-0.5">
            T-time {me.tTimePct.toFixed(0)}% · predictability {formatPercent(me.predictability.score)}
            {opponent !== null ? ` · opponent T-time ${opponent.tTimePct.toFixed(0)}%` : ""}
          </p>

          <div className="mt-auto pt-4">
            {detail !== null ? (
              <ButtonLink
                to={detail.to}
                variant="outline"
                size="sm"
                className="w-full"
                aria-label={`Show detailed analysis for ${title}`}
              >
                Show detailed analysis <ArrowUpRight className="h-4 w-4" />
              </ButtonLink>
            ) : (
              <>
                <Button variant="ghost" size="sm" className="w-full" disabled>
                  Show detailed analysis
                </Button>
                <p className="rq-caption mt-1 text-center">
                  Numbers only — tagged before frames and analyses were kept
                </p>
              </>
            )}
          </div>

          {showOwnerRow ? (
            <div className="mt-3 flex items-center gap-2">
              {onRedate !== undefined ? (
                // Uncontrolled, keyed on the stored date: a save that lands
                // remounts it on the new value, and a half-typed date never
                // round-trips to the server.
                <input
                  key={`${clip.id}-${clip.playedAt}`}
                  type="date"
                  aria-label={`Played on, for ${title}`}
                  defaultValue={clip.playedAt}
                  disabled={working}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next !== clip.playedAt && isPlausibleDay(next)) void onRedate(clip.id, next);
                  }}
                  className="rq-num min-h-[44px] min-w-0 flex-1 rounded-rq-sm border px-3 text-[14px]"
                  style={INPUT_STYLE}
                />
              ) : null}
              {onUntag !== undefined && !confirming ? (
                <button
                  type="button"
                  onClick={() => onConfirm(true)}
                  disabled={working}
                  aria-label={`Remove ${title} from ${playerName}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-rq-sm border transition-colors disabled:opacity-50"
                  style={{ borderColor: "var(--rq-line)", color: "var(--rq-text-dim)" }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          {confirming && onUntag !== undefined ? (
            <div className="mt-3" role="alertdialog" aria-label={`Remove ${title} from ${playerName}?`}>
              <Hairline />
              <p className="rq-caption mt-3">
                Remove this recording from {playerName}? The analysis stays in your library; only the
                name comes off.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button ref={confirmRemoveRef} variant="outline" size="sm" onClick={() => void onUntag(clip.id)} disabled={working}>
                  <Trash2 className="h-4 w-4" /> {working ? "Removing…" : "Remove"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onConfirm(false)} disabled={working}>
                  Keep
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
