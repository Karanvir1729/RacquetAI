import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cellLabel, formatClock, formatPercent, shotTypeLabel } from "@/analysis/format";
import { activeShotIndex } from "@/analysis/shots";
import type { MatchAnalysis, PlayerId, ShotEvent } from "@/analysis/types";
import { PoseOverlay } from "@/components/analysis/PoseOverlay";
import { Card, Hairline } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/lib/useElementSize";

/**
 * The match, playing, with the analysis laid over it.
 *
 * Custom transport rather than the browser's: the scrubber has to carry a tick
 * per detected shot (that strip is the single most useful thing on the page —
 * it shows the shape of the match at a glance), and the skeleton toggle has to
 * sit beside the play button rather than in a separate row. Every control is a
 * 44px target, and the keyboard gets space / arrows / J-K-L semantics via the
 * buttons themselves.
 *
 * Playhead state updates at ~25 Hz, not every animation frame: the pose track
 * is sampled at 8 Hz, so a faster tick would re-render for nothing — and this
 * component's subtree is the only thing on the page that re-renders during
 * playback.
 */

const TICK_HZ = 25;
const SKIP_SEC = 5;
const SPEEDS = [0.5, 1, 2];

/** Cycle the speed chip: 0.5 → 1 → 2 → 0.5. */
function nextSpeed(current: number): number {
  const index = SPEEDS.indexOf(current);
  return SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
}

/**
 * Player ink for marks that sit on the PAGE — the scrubber ticks and the dot
 * on the read-out chip. Distinct from the skeleton's `--rq-overlay-*`, which
 * is painted on video: Optic on a Chalk Wash background is nearly invisible,
 * so on the page player A takes the data ink, which deepens to Court Green in
 * light mode.
 */
const PLAYER_DOT: Record<PlayerId, string> = {
  A: "var(--rq-data)",
  B: "var(--rq-text)",
};

interface MatchPlayerProps {
  analysis: MatchAnalysis;
  /** Playable video for this analysis, or null when only the numbers exist. */
  videoSrc: string | null;
  /** Shown under the frame — where the footage came from. */
  caption?: string;
}

export function MatchPlayer({ analysis, videoSrc, caption }: MatchPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [boxRef, boxSize] = useElementSize<HTMLDivElement>();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [failed, setFailed] = useState(false);

  const { video, shots, tracks } = analysis;
  const duration = video.durationSec > 0 ? video.durationSec : 1;
  const aspect = video.width > 0 && video.height > 0 ? video.width / video.height : 16 / 9;

  const sortedShots = useMemo(() => [...shots].sort((a, b) => a.tSec - b.tSec), [shots]);
  const activeIndex = useMemo(() => activeShotIndex(shots, time), [shots, time]);
  const activeShot: ShotEvent | null = activeIndex === null ? null : (shots[activeIndex] ?? null);

  // ---- playhead -----------------------------------------------------------
  useEffect(() => {
    const element = videoRef.current;
    if (element === null) return;
    let frame = 0;
    let last = -1;

    const publish = (force: boolean) => {
      const now = element.currentTime;
      // Only wake React when the playhead has actually moved a tick's worth.
      if (!force && Math.abs(now - last) < 1 / TICK_HZ) return;
      last = now;
      setTime(now);
    };

    const step = () => {
      publish(false);
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);

    // rAF alone is not enough. Browsers pause it in a background tab and
    // throttle it under power saving, and a seek performed while the loop is
    // asleep would leave the skeleton and the shot read-out describing a
    // moment the video is no longer on. These events cover every such case.
    const sync = () => publish(true);
    element.addEventListener("timeupdate", sync);
    element.addEventListener("seeked", sync);
    element.addEventListener("loadedmetadata", sync);

    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener("timeupdate", sync);
      element.removeEventListener("seeked", sync);
      element.removeEventListener("loadedmetadata", sync);
    };
  }, [videoSrc]);

  useEffect(() => {
    const element = videoRef.current;
    if (element === null) return;
    element.playbackRate = speed;
  }, [speed]);

  const seek = useCallback(
    (to: number) => {
      const element = videoRef.current;
      const clamped = Math.max(0, Math.min(duration, to));
      setTime(clamped);
      if (element !== null) element.currentTime = clamped;
    },
    [duration],
  );

  const toggle = useCallback(() => {
    const element = videoRef.current;
    if (element === null) return;
    if (element.paused) void element.play().catch(() => setFailed(true));
    else element.pause();
  }, []);

  const stepShot = useCallback(
    (direction: 1 | -1) => {
      if (sortedShots.length === 0) return;
      const next =
        direction === 1
          ? sortedShots.find((shot) => shot.tSec > time + 0.05)
          : [...sortedShots].reverse().find((shot) => shot.tSec < time - 0.05);
      if (next === undefined) return;
      // Land a beat before contact so the swing is visible, not already over.
      seek(Math.max(0, next.tSec - 0.4));
    },
    [seek, sortedShots, time],
  );

  const goFullscreen = useCallback(() => {
    const element = shellRef.current;
    if (element === null) return;
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
    else void element.requestFullscreen?.().catch(() => undefined);
  }, []);

  const progress = Math.max(0, Math.min(1, time / duration));

  return (
    <Card className="overflow-hidden" style={{ boxShadow: "var(--rq-lift-shadow)" }}>
      <div ref={shellRef} className="relative" style={{ background: "var(--rq-court-floor)" }}>
        <div
          ref={boxRef}
          className="relative w-full"
          style={{ aspectRatio: `${aspect}`, background: "var(--rq-court-floor)" }}
        >
          {videoSrc !== null && !failed ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="absolute inset-0 h-full w-full object-contain"
              playsInline
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setFailed(true)}
              onLoadedMetadata={(event) => {
                event.currentTarget.playbackRate = speed;
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="rq-caption max-w-sm">
                {failed
                  ? "This browser could not play the video file. The measurements below are unaffected."
                  : "No video is attached to this analysis — the measurements below still apply."}
              </p>
            </div>
          )}

          <PoseOverlay
            tracks={tracks}
            videoSize={{ width: video.width, height: video.height }}
            box={boxSize}
            timeSec={time}
            visible={showSkeleton && videoSrc !== null && !failed}
          />

          {tracks === undefined ? (
            <div className="pointer-events-none absolute right-3 top-3">
              <span
                className="rounded-rq-sm border px-2.5 py-1.5 text-[11px] font-bold backdrop-blur-md"
                style={{
                  borderColor: "var(--rq-line-2)",
                  background: "var(--rq-chip)",
                  color: "var(--rq-text-dim)",
                }}
              >
                No pose track in this file
              </span>
            </div>
          ) : null}
        </div>

        {/* The live read-out. Over the frame from `sm` up, where there is room
            in the corner; on a phone it drops below the picture instead, because
            a two-line badge at 375px covers the players it is describing. It
            never unmounts — it holds its slot between shots so the layout does
            not jump on every contact. */}
        <div className="pointer-events-none px-3 pb-3 sm:absolute sm:left-3 sm:top-3 sm:max-w-[calc(100%-1.5rem)] sm:p-0">
          <ShotBadge shot={activeShot} analysis={analysis} />
        </div>
      </div>

      <Hairline />

      {/* ---- scrubber -------------------------------------------------- */}
      <div className="px-4 pt-4 sm:px-5">
        <div className="relative">
          {/* Shot ticks, behind the control. Player A above the line, B below,
              so a rally reads as an exchange rather than a picket fence. */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2">
            {sortedShots.map((shot, index) => (
              <span
                key={`${shot.tSec}-${index}`}
                className="absolute w-px"
                style={{
                  left: `${Math.max(0, Math.min(1, shot.tSec / duration)) * 100}%`,
                  top: shot.player === "A" ? 0 : "50%",
                  height: "50%",
                  background: PLAYER_DOT[shot.player],
                  opacity: shot === activeShot ? 1 : 0.34,
                }}
              />
            ))}
          </div>
          <input
            className="rq-scrub relative w-full"
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={time}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Seek through the match"
            aria-valuetext={formatClock(time)}
            style={{ "--rq-scrub-progress": `${progress * 100}%` } as CSSProperties}
          />
        </div>

        <div className="mt-1 flex items-center justify-between">
          <span className="rq-num text-[12.5px]" style={{ color: "var(--rq-text-dim)" }}>
            {formatClock(time)}
          </span>
          <span className="rq-num text-[12.5px]" style={{ color: "var(--rq-text-faint)" }}>
            {formatClock(duration)}
          </span>
        </div>
      </div>

      {/* ---- transport --------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-2 sm:px-5">
        <TransportButton
          onClick={toggle}
          label={playing ? "Pause" : "Play"}
          disabled={videoSrc === null || failed}
          primary
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </TransportButton>
        <TransportButton onClick={() => seek(time - SKIP_SEC)} label={`Back ${SKIP_SEC} seconds`}>
          <RotateCcw style={{ width: 18, height: 18 }} />
        </TransportButton>
        <TransportButton onClick={() => stepShot(-1)} label="Previous detected shot">
          <ChevronLeft className="h-5 w-5" />
        </TransportButton>
        <TransportButton onClick={() => stepShot(1)} label="Next detected shot">
          <ChevronRight className="h-5 w-5" />
        </TransportButton>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSpeed(nextSpeed)}
            className="rq-num inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-rq-sm border px-3 text-[13px] font-extrabold"
            style={{
              borderColor: "var(--rq-line)",
              background: "var(--rq-card)",
              color: "var(--rq-text-dim)",
            }}
            aria-label={`Playback speed ${speed}x — tap to change`}
          >
            {speed}×
          </button>
          <button
            type="button"
            onClick={() => setShowSkeleton((value) => !value)}
            aria-pressed={showSkeleton}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-rq-sm border px-3 text-[13px] font-extrabold"
            style={{
              borderColor: showSkeleton ? "var(--rq-accent-line)" : "var(--rq-line)",
              background: showSkeleton ? "var(--rq-accent-soft)" : "var(--rq-card)",
              color: showSkeleton ? "var(--rq-accent-text)" : "var(--rq-text-dim)",
            }}
          >
            <ScanLine className="h-4 w-4" />
            <span className="hidden sm:inline">Skeleton</span>
          </button>
          <TransportButton onClick={goFullscreen} label="Full screen">
            <Expand className="h-5 w-5" />
          </TransportButton>
        </div>
      </div>

      {caption !== undefined ? (
        <>
          <Hairline />
          <p className="px-4 py-3 text-[12.5px] sm:px-5" style={{ color: "var(--rq-text-faint)" }}>
            {caption}
          </p>
        </>
      ) : null}
    </Card>
  );
}

function TransportButton({
  children,
  onClick,
  label,
  disabled = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-rq-sm border transition-opacity",
        disabled && "pointer-events-none opacity-40",
      )}
      style={{
        borderColor: primary ? "var(--rq-accent)" : "var(--rq-line)",
        background: primary ? "var(--rq-accent)" : "var(--rq-card)",
        color: primary ? "var(--rq-on-accent)" : "var(--rq-text)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * The live read-out. Names the striker, the quadrant the ball was placed into
 * and — only when the file carries one — the shot class with its confidence,
 * because a class at 0.34 and a class at 0.9 are not the same claim.
 */
function ShotBadge({ shot, analysis }: { shot: ShotEvent | null; analysis: MatchAnalysis }) {
  const label =
    shot === null
      ? null
      : (analysis.players.find((player) => player.id === shot.player)?.label ??
        `Player ${shot.player}`);

  return (
    <span
      className="inline-flex items-center gap-2.5 rounded-rq-sm border px-3 py-2 backdrop-blur-md"
      style={{
        borderColor: "var(--rq-line-2)",
        background: "var(--rq-chip)",
        boxShadow: "var(--rq-card-shadow)",
        opacity: shot === null ? 0.72 : 1,
      }}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          background: shot === null ? "var(--rq-text-faint)" : PLAYER_DOT[shot.player],
        }}
      />
      {shot === null ? (
        <span className="text-[12.5px] font-bold" style={{ color: "var(--rq-text-dim)" }}>
          Between shots
        </span>
      ) : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-[12.5px] font-extrabold" style={{ color: "var(--rq-text)" }}>
            {label}
          </span>
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--rq-text-dim)" }}>
            {shot.type === undefined ? cellLabel(shot.cell) : `${shotTypeLabel(shot.type)} · ${cellLabel(shot.cell).toLowerCase()}`}
          </span>
          {shot.typeConfidence !== undefined ? (
            <span className="rq-num text-[11px] font-bold" style={{ color: "var(--rq-text-faint)" }}>
              {formatPercent(shot.typeConfidence)} conf.
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
