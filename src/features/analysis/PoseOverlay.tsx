/**
 * The pose skeletons drawn over the match video — the visible half of "watch
 * the computer analyze their shot". Absolutely positioned inside the video box
 * and non-interactive, so the native transport controls underneath still take
 * every touch.
 *
 * Deliberately drawn with plain Views rather than react-native-svg: that is a
 * NATIVE dependency, and this app ships a prebuilt dev client / TestFlight
 * binary. Adding it to package.json without a pod install + rebuild would red-
 * screen the analysis screen on every existing build — strictly worse than the
 * bars-and-dots figure below, which is ~2 x 24 leaf Views refreshed at the 8 Hz
 * sample rate and well inside RN's budget. Revisit if the overlay ever needs
 * strokes, gradients or paths.
 */
import { memo } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";

import { colors, radius } from "@/theme/tokens";

import type { Size } from "./letterbox";
import { poseFigures, type PoseFigureStyle } from "./pose";
import type { PlayerId, TrackFrame } from "./types";

const FIGURE_STYLE: PoseFigureStyle = {
  boneThickness: 2.5,
  jointSize: 6,
  // Below this a keypoint is usually the estimator hallucinating an occluded
  // limb, and a bone drawn to it swings wildly frame to frame.
  minConfidence: 0.3,
};

/**
 * Skeleton ink, drawn ON THE VIDEO. The two hues are picked purely because they
 * separate cleanly over squash footage (white walls, dark kit), so they are the
 * non-flipping `overlay*` tokens: a theme pair here would repaint the same
 * player over the same footage when the phone's appearance setting changed.
 */
const SKELETON_COLORS: Record<PlayerId, ColorValue> = {
  A: colors.overlayA,
  B: colors.overlayB,
};

/**
 * Player ink for marks that sit on the PAGE — the legend dots on the video
 * card. Distinct from `SKELETON_COLORS` above, which is painted on footage:
 * Optic on a Chalk Wash card is nearly invisible, so on the page player A takes
 * the data ink (Court Green on light) and player B the page text colour. Same
 * split the web makes in components/analysis/MatchPlayer.tsx.
 */
export const PLAYER_COLORS: Record<PlayerId, ColorValue> = {
  A: colors.data,
  B: colors.text,
};

interface PoseOverlayProps {
  /** The sample nearest the playhead, or null to draw nothing. */
  frame: TrackFrame | null;
  /** Intrinsic size of the analysed frame the keypoints are normalized to. */
  videoSize: Size;
  /** Measured size of the video box; null until the first layout pass. */
  boxSize: Size | null;
}

export const PoseOverlay = memo(function PoseOverlay({
  frame,
  videoSize,
  boxSize,
}: PoseOverlayProps) {
  const figures = poseFigures(frame, videoSize, boxSize, FIGURE_STYLE);
  if (figures.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {figures.map((figure) => {
        const color = SKELETON_COLORS[figure.id];
        return (
          <View key={figure.id} style={StyleSheet.absoluteFill}>
            {figure.bones.map((bone) => (
              <View
                key={bone.key}
                style={[
                  styles.bone,
                  {
                    left: bone.left,
                    top: bone.top,
                    width: bone.width,
                    height: bone.height,
                    backgroundColor: color,
                    transform: [{ rotate: `${bone.rotateDeg}deg` }],
                  },
                ]}
              />
            ))}
            {figure.joints.map((joint) => (
              <View
                key={joint.key}
                style={[
                  styles.joint,
                  { left: joint.left, top: joint.top, backgroundColor: color },
                ]}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  bone: { position: "absolute", borderRadius: radius.pill, opacity: 0.9 },
  // The casing is what keeps a figure readable over a same-coloured wall or
  // kit. Only the joints carry it: at 6pt a 1pt ring still leaves a 4pt core,
  // whereas the 2.5pt bone would lose 2 of its 2.5pt to a border and render as
  // an almost-solid ink bar.
  joint: {
    position: "absolute",
    width: FIGURE_STYLE.jointSize,
    height: FIGURE_STYLE.jointSize,
    borderRadius: FIGURE_STYLE.jointSize / 2,
    borderWidth: 1,
    borderColor: colors.overlayCasing,
  },
});
