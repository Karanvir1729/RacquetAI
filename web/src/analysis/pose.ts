/**
 * Pose-overlay geometry — which sample of `tracks` belongs on screen right
 * now, and where each bone and joint lands inside the rendered video box.
 * Ported from the app's `src/features/analysis/pose.ts`; the bone list, the
 * joint list and the nearest-frame search are the same, so both clients draw
 * the same figure from the same payload.
 *
 * Two divergences, both because this is the web:
 *  - the app lays a bone out as a rotated <View> bar (React Native has no
 *    line primitive); here a bone is just its two endpoints, because the
 *    overlay is an SVG and `<line>` is exact, cheaper and antialiases.
 *  - array reads are guarded rather than indexed blind: this project compiles
 *    with `noUncheckedIndexedAccess`, and a short `k` really can arrive from a
 *    third-party server.
 *
 * Keypoints are normalized against the ANALYSED frame and the <video> renders
 * `object-fit: contain`, so every coordinate goes through `containRect` first.
 * Skipping that skews the whole skeleton by the letterbox bar width — the most
 * visible possible bug in this feature.
 */
import { containRect, type Point, type Rect, type Size } from "./letterbox";
import {
  POSE_KEYPOINT_NAMES,
  POSE_VALUE_COUNT,
  type PlayerId,
  type PoseKeypointName,
  type TrackFrame,
} from "./types";

const keypointIndex = (name: PoseKeypointName): number => POSE_KEYPOINT_NAMES.indexOf(name);

/** Torso, shoulders, hips and both limbs — the stick figure, no face. */
export const POSE_BONES: readonly (readonly [number, number])[] = [
  [keypointIndex("leftShoulder"), keypointIndex("rightShoulder")],
  [keypointIndex("leftShoulder"), keypointIndex("leftElbow")],
  [keypointIndex("leftElbow"), keypointIndex("leftWrist")],
  [keypointIndex("rightShoulder"), keypointIndex("rightElbow")],
  [keypointIndex("rightElbow"), keypointIndex("rightWrist")],
  [keypointIndex("leftShoulder"), keypointIndex("leftHip")],
  [keypointIndex("rightShoulder"), keypointIndex("rightHip")],
  [keypointIndex("leftHip"), keypointIndex("rightHip")],
  [keypointIndex("leftHip"), keypointIndex("leftKnee")],
  [keypointIndex("leftKnee"), keypointIndex("leftAnkle")],
  [keypointIndex("rightHip"), keypointIndex("rightKnee")],
  [keypointIndex("rightKnee"), keypointIndex("rightAnkle")],
];

/**
 * Dotted joints: the nose stands in for the head, then everything from the
 * shoulders down. Eyes and ears are omitted — at match framing a player's head
 * is a few pixels across and five dots there render as a blob.
 */
export const POSE_JOINTS: readonly number[] = [
  keypointIndex("nose"),
  ...POSE_KEYPOINT_NAMES.slice(keypointIndex("leftShoulder")).map((name) => keypointIndex(name)),
];

/**
 * How far the playhead may sit from a sample before the overlay gives up.
 * Tracks are sampled at ~8 Hz (0.125 s apart), so this tolerates a couple of
 * missed samples yet still clears the skeleton where tracking stops instead of
 * pinning a stale pose over a later part of the match.
 */
export const TRACK_TOLERANCE_SEC = 0.3;

/** One bone as its two endpoints, in container coordinates. */
export interface BoneSegment {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Centre of a joint dot, in container coordinates. */
export interface JointDot {
  key: string;
  x: number;
  y: number;
}

export interface PoseFigure {
  id: PlayerId;
  bones: BoneSegment[];
  joints: JointDot[];
}

/** Keypoints below this confidence are not drawn at all. */
export const DEFAULT_MIN_CONFIDENCE = 0.3;

/**
 * Index of the sample nearest `tSec`, or null when there is nothing close
 * enough (or no tracks at all). `tracks` must be ascending by `t` —
 * `parseAnalysisValue` guarantees it.
 */
export function nearestTrackIndex(
  tracks: readonly TrackFrame[],
  tSec: number,
  toleranceSec: number = TRACK_TOLERANCE_SEC,
): number | null {
  if (tracks.length === 0 || !Number.isFinite(tSec)) return null;
  let low = 0;
  let high = tracks.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    const frame = tracks[mid];
    if (frame === undefined) break;
    if (frame.t < tSec) low = mid + 1;
    else high = mid;
  }
  // `low` is the first sample at or after tSec; its predecessor may be nearer.
  const at = tracks[low];
  if (at === undefined) return null;
  let best = low;
  const before = low > 0 ? tracks[low - 1] : undefined;
  if (before !== undefined && Math.abs(before.t - tSec) < Math.abs(at.t - tSec)) {
    best = low - 1;
  }
  const chosen = tracks[best];
  if (chosen === undefined) return null;
  return Math.abs(chosen.t - tSec) <= toleranceSec ? best : null;
}

/** The frame nearest `tSec`, or null — the form every caller actually wants. */
export function trackFrameAt(
  tracks: readonly TrackFrame[] | undefined,
  tSec: number,
  toleranceSec: number = TRACK_TOLERANCE_SEC,
): TrackFrame | null {
  if (tracks === undefined) return null;
  const index = nearestTrackIndex(tracks, tSec, toleranceSec);
  return index === null ? null : (tracks[index] ?? null);
}

function keypointAt(k: number[], index: number, rect: Rect, minConfidence: number): Point | null {
  const base = index * 3;
  const x = k[base];
  const y = k[base + 1];
  const confidence = k[base + 2];
  if (x === undefined || y === undefined || confidence === undefined) return null;
  if (confidence < minConfidence) return null;
  return { x: rect.x + x * rect.width, y: rect.y + y * rect.height };
}

/**
 * One figure per confidently-detected player in `frame`, positioned in the
 * coordinates of a `box`-sized container showing a `videoSize` frame. Empty
 * whenever there is nothing to draw — no frame, unmeasured layout, degenerate
 * video dimensions — so the caller never has to special-case those.
 */
export function poseFigures(
  frame: TrackFrame | null,
  videoSize: Size,
  box: Size | null,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): PoseFigure[] {
  if (frame === null || box === null) return [];
  const rect = containRect(box, videoSize);
  if (rect === null) return [];

  const figures: PoseFigure[] = [];
  for (const pose of frame.p) {
    if (pose.k.length !== POSE_VALUE_COUNT) continue;
    const bones: BoneSegment[] = [];
    for (const bone of POSE_BONES) {
      const [from, to] = bone;
      const a = keypointAt(pose.k, from, rect, minConfidence);
      const b = keypointAt(pose.k, to, rect, minConfidence);
      // A bone needs both ends: half a limb drawn to a guessed joint misleads.
      if (a === null || b === null) continue;
      bones.push({ key: `${from}-${to}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    const joints: JointDot[] = [];
    for (const index of POSE_JOINTS) {
      const at = keypointAt(pose.k, index, rect, minConfidence);
      if (at === null) continue;
      joints.push({ key: String(index), x: at.x, y: at.y });
    }
    if (bones.length === 0 && joints.length === 0) continue;
    figures.push({ id: pose.id, bones, joints });
  }
  return figures;
}
