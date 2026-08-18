import { nearestTrackIndex, poseFigures, type PoseFigureStyle } from "../pose";
import {
  POSE_KEYPOINT_NAMES,
  POSE_VALUE_COUNT,
  type PoseKeypointName,
  type TrackFrame,
} from "../types";

const STYLE: PoseFigureStyle = { boneThickness: 2, jointSize: 6, minConfidence: 0.3 };

/**
 * A pose with only the named keypoints confident — everything else sits at
 * confidence 0, which is exactly how an occluded joint arrives.
 */
function poseWith(points: Partial<Record<PoseKeypointName, [number, number, number]>>): number[] {
  const k = new Array<number>(POSE_VALUE_COUNT).fill(0);
  for (const [name, value] of Object.entries(points)) {
    if (value === undefined) continue;
    const base = POSE_KEYPOINT_NAMES.indexOf(name as PoseKeypointName) * 3;
    [k[base], k[base + 1], k[base + 2]] = value;
  }
  return k;
}

const frameAt = (t: number, k: number[]): TrackFrame => ({ t, p: [{ id: "A", k }] });

describe("nearestTrackIndex", () => {
  const tracks: TrackFrame[] = [0, 0.125, 0.25, 0.375, 0.5].map((t) => ({ t, p: [] }));

  it("finds the sample on either side of the playhead", () => {
    expect(nearestTrackIndex(tracks, 0.25)).toBe(2);
    expect(nearestTrackIndex(tracks, 0.26)).toBe(2);
    expect(nearestTrackIndex(tracks, 0.32)).toBe(3);
    expect(nearestTrackIndex(tracks, 0)).toBe(0);
    expect(nearestTrackIndex(tracks, 0.5)).toBe(4);
  });

  it("clamps to the ends while they are still within tolerance", () => {
    expect(nearestTrackIndex(tracks, -0.1)).toBe(0);
    expect(nearestTrackIndex(tracks, 0.7)).toBe(4);
  });

  it("gives up rather than pinning a stale pose over a later part of the match", () => {
    expect(nearestTrackIndex(tracks, 300)).toBeNull();
    expect(nearestTrackIndex(tracks, -5)).toBeNull();
  });

  it("returns null for no tracks or an unusable time", () => {
    expect(nearestTrackIndex([], 1)).toBeNull();
    expect(nearestTrackIndex(tracks, Number.NaN)).toBeNull();
  });
});

describe("poseFigures", () => {
  // A 4:3 frame inside a 16:9 box draws 240x180 with 40pt bars left and right.
  const box = { width: 320, height: 180 };
  const video = { width: 640, height: 480 };

  it("letterbox-corrects keypoints onto the drawn video rect", () => {
    const frame = frameAt(0, poseWith({ nose: [0.5, 0.5, 0.9] }));
    const [figure] = poseFigures(frame, video, box, STYLE);
    // Centre of the frame is the centre of the drawn rect, not of the box.
    expect(figure.joints).toEqual([{ key: "0", left: 160 - 3, top: 90 - 3 }]);
  });

  it("lays a bone out as a centre-rotated bar between its two joints", () => {
    const frame = frameAt(
      0,
      poseWith({ leftShoulder: [0.25, 0.5, 0.9], rightShoulder: [0.75, 0.5, 0.9] }),
    );
    const [figure] = poseFigures(frame, video, box, STYLE);
    expect(figure.bones).toHaveLength(1);
    // 0.25..0.75 of a 240pt-wide drawn rect = 120pt, horizontal.
    expect(figure.bones[0]).toEqual({
      key: "5-6",
      left: 100,
      top: 89,
      width: 120,
      height: 2,
      rotateDeg: 0,
    });
  });

  it("angles a bone with its joints", () => {
    const frame = frameAt(
      0,
      poseWith({ leftHip: [0.5, 0.25, 0.9], leftKnee: [0.5, 0.75, 0.9] }),
    );
    const [figure] = poseFigures(frame, video, box, STYLE);
    expect(figure.bones[0].rotateDeg).toBeCloseTo(90);
    expect(figure.bones[0].width).toBeCloseTo(90);
  });

  it("skips a bone with only one confident end", () => {
    const frame = frameAt(
      0,
      poseWith({ leftShoulder: [0.25, 0.5, 0.9], rightShoulder: [0.75, 0.5, 0.1] }),
    );
    const [figure] = poseFigures(frame, video, box, STYLE);
    expect(figure.bones).toEqual([]);
    expect(figure.joints.map((joint) => joint.key)).toEqual(["5"]);
  });

  it("drops a figure with nothing confident enough to draw", () => {
    const frame = frameAt(0, poseWith({ nose: [0.5, 0.5, 0.2] }));
    expect(poseFigures(frame, video, box, STYLE)).toEqual([]);
  });

  it("draws nothing before layout, without a frame, or on a degenerate video", () => {
    const frame = frameAt(0, poseWith({ nose: [0.5, 0.5, 0.9] }));
    expect(poseFigures(frame, video, null, STYLE)).toEqual([]);
    expect(poseFigures(null, video, box, STYLE)).toEqual([]);
    expect(poseFigures(frame, { width: 0, height: 0 }, box, STYLE)).toEqual([]);
  });

  it("keeps one figure per detected player", () => {
    const frame: TrackFrame = {
      t: 0,
      p: [
        { id: "A", k: poseWith({ nose: [0.25, 0.5, 0.9] }) },
        { id: "B", k: poseWith({ nose: [0.75, 0.5, 0.9] }) },
      ],
    };
    expect(poseFigures(frame, video, box, STYLE).map((figure) => figure.id)).toEqual(["A", "B"]);
  });
});
