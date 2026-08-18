/**
 * Pose-overlay geometry: which frame of `tracks` belongs on screen right now,
 * and where each bone and joint lands inside the rendered video box. Pure and
 * unit-tested for the same reason letterbox.ts is — a skeleton that sits a few
 * points off the players is the most obvious possible bug, and it cannot be
 * caught by reading the component.
 *
 * Keypoints arrive normalized against the ANALYSED frame, and the video
 * renders `contentFit="contain"`, so the drawn picture is inset by letterbox
 * bars. Every coordinate therefore goes through `containRect` first; skipping
 * that skews the whole figure by the bar width.
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
 * is a few points across and five dots there render as a blob.
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

/** An absolutely-positioned, centre-rotated bar standing in for one bone. */
export interface BoneLayout {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotateDeg: number;
}

/** Top-left of a square joint dot. */
export interface JointLayout {
  key: string;
  left: number;
  top: number;
}

export interface PoseFigure {
  id: PlayerId;
  bones: BoneLayout[];
  joints: JointLayout[];
}

export interface PoseFigureStyle {
  /** Bar thickness in layout points. */
  boneThickness: number;
  /** Dot edge length in layout points. */
  jointSize: number;
  /** Keypoints below this confidence are not drawn at all. */
  minConfidence: number;
}

/**
 * Index of the sample nearest `tSec`, or null when there is nothing close
 * enough (or no tracks at all). `tracks` must be ascending by `t` —
 * `parseAnalysis` guarantees it.
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
    if (tracks[mid].t < tSec) low = mid + 1;
    else high = mid;
  }
  // `low` is the first sample at or after tSec; its predecessor may be nearer.
  let best = low;
  if (low > 0 && Math.abs(tracks[low - 1].t - tSec) < Math.abs(tracks[low].t - tSec)) {
    best = low - 1;
  }
  return Math.abs(tracks[best].t - tSec) <= toleranceSec ? best : null;
}

function keypointAt(k: number[], index: number, rect: Rect, minConfidence: number): Point | null {
  const base = index * 3;
  if (k[base + 2] < minConfidence) return null;
  return { x: rect.x + k[base] * rect.width, y: rect.y + k[base + 1] * rect.height };
}

function boneLayout(key: string, a: Point, b: Point, thickness: number): BoneLayout {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const width = Math.hypot(dx, dy);
  return {
    key,
    // Laid out centred on the bone's midpoint, then rotated about that centre.
    left: (a.x + b.x) / 2 - width / 2,
    top: (a.y + b.y) / 2 - thickness / 2,
    width,
    height: thickness,
    rotateDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
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
  style: PoseFigureStyle,
): PoseFigure[] {
  if (frame === null || box === null) return [];
  const rect = containRect(box, videoSize);
  if (rect === null) return [];

  const figures: PoseFigure[] = [];
  for (const pose of frame.p) {
    if (pose.k.length !== POSE_VALUE_COUNT) continue;
    const bones: BoneLayout[] = [];
    for (const [from, to] of POSE_BONES) {
      const a = keypointAt(pose.k, from, rect, style.minConfidence);
      const b = keypointAt(pose.k, to, rect, style.minConfidence);
      // A bone needs both ends: half a limb drawn to a guessed joint misleads.
      if (a === null || b === null) continue;
      bones.push(boneLayout(`${from}-${to}`, a, b, style.boneThickness));
    }
    const joints: JointLayout[] = [];
    for (const index of POSE_JOINTS) {
      const at = keypointAt(pose.k, index, rect, style.minConfidence);
      if (at === null) continue;
      joints.push({
        key: String(index),
        left: at.x - style.jointSize / 2,
        top: at.y - style.jointSize / 2,
      });
    }
    if (bones.length === 0 && joints.length === 0) continue;
    figures.push({ id: pose.id, bones, joints });
  }
  return figures;
}
