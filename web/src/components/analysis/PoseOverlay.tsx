import { useMemo } from "react";

import { poseFigures, trackFrameAt } from "@/analysis/pose";
import type { PlayerId, TrackFrame } from "@/analysis/types";
import type { Size } from "@/lib/useElementSize";

/**
 * The skeleton, drawn over the video and moving with it.
 *
 * An SVG sized to the video's rendered box, with every coordinate run through
 * the letterbox maths in `pose.ts` — the video is `object-fit: contain`, so
 * measuring against the element instead of the drawn picture puts the figures
 * off the players by the width of a bar. Player A is Optic, player B is chalk,
 * and both get an ink casing stroke underneath so a bright limb stays visible
 * against a bright wall.
 *
 * Those three colours come from `--rq-overlay-*`, which do NOT flip with the
 * theme — see the note in tokens.css. They are painted onto footage, and a
 * squash court looks the same whichever theme the visitor picked.
 *
 * There is no interpolation between samples: tracks are ~8 Hz and the overlay
 * shows the nearest one within 0.3 s. Where tracking dropped out, the skeleton
 * disappears rather than freezing on the last good pose — an honest gap beats
 * a figure standing still while the player runs.
 */

const PLAYER_INK: Record<PlayerId, string> = {
  A: "var(--rq-overlay-a)",
  B: "var(--rq-overlay-b)",
};

interface PoseOverlayProps {
  tracks: readonly TrackFrame[] | undefined;
  /** Dimensions of the ANALYSED frame — what the keypoints are normalized to. */
  videoSize: Size;
  /** Measured size of the element the video renders into. */
  box: Size | null;
  timeSec: number;
  visible: boolean;
}

export function PoseOverlay({ tracks, videoSize, box, timeSec, visible }: PoseOverlayProps) {
  const frame: TrackFrame | null = useMemo(
    () => trackFrameAt(tracks, timeSec),
    [tracks, timeSec],
  );
  const figures = useMemo(() => poseFigures(frame, videoSize, box), [frame, videoSize, box]);

  if (!visible || box === null || figures.length === 0) return null;

  // Scale the stroke with the box: a 2px bone that reads correctly on a phone
  // is a hairline on a 1400px player.
  const scale = Math.max(0.6, Math.min(1.8, box.width / 720));
  const bone = 2.4 * scale;
  const joint = 2.6 * scale;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      width={box.width}
      height={box.height}
      viewBox={`0 0 ${box.width} ${box.height}`}
      aria-hidden="true"
    >
      {figures.map((figure) => (
        <g key={figure.id}>
          {/* Casing first: the same geometry in ink, slightly fatter, so the
              figure separates from a pale court floor or a white wall. */}
          <g
            stroke="var(--rq-overlay-casing)"
            strokeOpacity="0.55"
            strokeWidth={bone + 2 * scale}
            strokeLinecap="round"
            fill="none"
          >
            {figure.bones.map((segment) => (
              <line
                key={segment.key}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
              />
            ))}
          </g>
          <g
            stroke={PLAYER_INK[figure.id]}
            strokeWidth={bone}
            strokeLinecap="round"
            fill="none"
            opacity="0.95"
          >
            {figure.bones.map((segment) => (
              <line
                key={segment.key}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
              />
            ))}
          </g>
          <g fill={PLAYER_INK[figure.id]}>
            {figure.joints.map((dot) => (
              <circle key={dot.key} cx={dot.x} cy={dot.y} r={joint / 2} />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}
