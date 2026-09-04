/**
 * Score an analysed match from its own footage, on the web.
 *
 * The phone's "Score a video", with the same engine behind it (see
 * useWebVideoReferee). The video element is the user's own local copy — the
 * server never sends footage back, so this only appears in the tab that
 * uploaded it.
 */
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useWebVideoReferee } from "@/referee/useWebVideoReferee";
import type { MatchAnalysis } from "@/analysis/types";
import type { Side } from "@app/features/scoring/types";

export function VideoRefereePanel({
  analysis,
  videoSrc,
}: {
  analysis: MatchAnalysis;
  videoSrc: string;
}) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ref = useWebVideoReferee(analysis);

  const pause = useCallback(() => {
    try {
      videoRef.current?.pause();
    } catch {
      /* not ready */
    }
  }, []);

  // Correcting anything stops playback writing to the score, and stops the
  // footage — a video that keeps rolling while it no longer scores is the
  // genuinely confusing state.
  const award = useCallback(
    (side: Side) => {
      pause();
      ref.awardRally(side);
    },
    [pause, ref],
  );

  if (!open) {
    return (
      <Card className="mt-6 p-5">
        <h3 className="text-[15px] font-semibold text-[var(--rq-text)]">Score this match</h3>
        <p className="mt-1 text-[13px] text-[var(--rq-text-dim)]">
          Play the footage and let RacketIQ call each rally as it reaches it — the same PAR-11
          scoreboard the app uses. Every call is one tap to correct.
        </p>
        <Button className="mt-3" size="sm" onClick={() => setOpen(true)}>
          Score a video
        </Button>
      </Card>
    );
  }

  const { score, names, result } = ref;

  return (
    <Card className="mt-6 p-5">
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        playsInline
        className="w-full rounded-lg bg-black"
        onTimeUpdate={(e) => ref.onTime(e.currentTarget.currentTime)}
        onEnded={ref.onEnded}
      />

      <div className="mt-4 grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((side) => (
          <div
            key={side}
            className={cn(
              "rounded-xl border p-3 text-center",
              score.server === side
                ? "border-[var(--rq-accent-text)] bg-[var(--rq-card-raised)]"
                : "border-[var(--rq-line)] bg-[var(--rq-card)]",
            )}
          >
            <div className="truncate text-[12px] text-[var(--rq-text-dim)]">{names[side]}</div>
            <div className="text-4xl font-bold tabular-nums text-[var(--rq-text)]">
              {score.points[side]}
            </div>
            <div className="text-[11px] text-[var(--rq-text-dim)]">
              {score.games[side]} {score.games[side] === 1 ? "game" : "games"}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 min-h-[2.5rem] text-center text-[14px] text-[var(--rq-text)]">
        {ref.lastCall ?? "Press play — rallies are called as the video reaches them."}
      </p>
      <p className="text-center text-[12px] text-[var(--rq-text-faint)]">
        {ref.called} of {ref.total} rallies called
        {ref.detached ? " · you have the pen" : ""}
        {result.discarded > 0 ? ` · ${result.discarded} stray sound skipped` : ""}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => award(side)}
            className="min-h-[56px] rounded-xl border border-[var(--rq-line-2)] bg-[var(--rq-card-raised)] px-3 text-[14px] font-semibold text-[var(--rq-text)] transition-colors hover:bg-[var(--rq-chip)]"
          >
            {names[side]} won the rally
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { pause(); ref.undo(); }}>
          Undo
        </Button>
        {ref.detached ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              ref.handBack(videoRef.current?.currentTime ?? 0);
              try {
                void videoRef.current?.play();
              } catch {
                /* the native control still works */
              }
            }}
          >
            Hand scoring back to the video
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={ref.swapPlayers}>
          Swap players
        </Button>
        <Button variant="outline" size="sm" onClick={() => ref.setMuted(!ref.muted)}>
          {ref.muted ? "Unmute" : "Mute"}
        </Button>
      </div>
    </Card>
  );
}
