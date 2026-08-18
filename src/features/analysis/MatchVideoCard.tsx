/**
 * Inline player for the analysis page's source video, with the pose overlay on
 * top and a live read-out of the shot being played. Mounted only when a video
 * URI exists for the analysis (the hook must run unconditionally, so the
 * conditional lives at the call site, not here). Same expo-video pattern as
 * the Library's PlayerModal, but inline and paused by default.
 *
 * The playhead is sampled through `timeUpdate` rather than polled: the event
 * is off by default (`timeUpdateEventInterval` 0) and stays off for a v1
 * analysis, so a file with neither tracks nor shot types costs exactly what it
 * did before. State holds INDICES, not the raw time, so a tick that lands on
 * the same sample re-renders nothing.
 */
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { formatClock } from "@/lib/format";
import { colors, radius, spacing, type } from "@/theme/tokens";

import { cellLabel, shotTypeLabel } from "./format";
import type { Size } from "./letterbox";
import { nearestTrackIndex } from "./pose";
import { PLAYER_COLORS, PoseOverlay } from "./PoseOverlay";
import { activeShotIndex } from "./shots";
import type { MatchAnalysis, PlayerId } from "./types";

/** Matches the ~8 Hz track sampling; finer would only re-pick the same frame. */
const TIME_UPDATE_INTERVAL_SEC = 0.125;

interface MatchVideoCardProps {
  videoUri: string;
  analysis: MatchAnalysis;
}

export function MatchVideoCard({ videoUri, analysis }: MatchVideoCardProps) {
  const tracks = analysis.tracks ?? null;
  const hasShotTypes = useMemo(
    () => analysis.shots.some((shot) => shot.type !== undefined),
    [analysis.shots],
  );
  const followsPlayhead = tracks !== null || hasShotTypes;

  const player = useVideoPlayer(videoUri, (instance) => {
    instance.loop = false;
    instance.muted = false;
    instance.timeUpdateEventInterval = followsPlayhead ? TIME_UPDATE_INTERVAL_SEC : 0;
  });

  const [boxSize, setBoxSize] = useState<Size | null>(null);
  // Seeded at t=0 so the paused poster frame already carries a skeleton — no
  // timeUpdate fires until the user presses play.
  const [frameIndex, setFrameIndex] = useState<number | null>(() =>
    tracks === null ? null : nearestTrackIndex(tracks, 0),
  );
  const [shotIndex, setShotIndex] = useState<number | null>(null);

  // `useEventListener` keeps the newest listener in a ref, so an inline arrow
  // costs nothing and never goes stale.
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    setFrameIndex(tracks === null ? null : nearestTrackIndex(tracks, currentTime));
    setShotIndex(hasShotTypes ? activeShotIndex(analysis.shots, currentTime) : null);
  });

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBoxSize({ width, height });
  }, []);

  const frame = tracks !== null && frameIndex !== null ? tracks[frameIndex] : null;
  const shot = shotIndex !== null ? analysis.shots[shotIndex] : null;
  const readout =
    shot !== null
      ? `${formatClock(shot.tSec)} · ${playerLabel(analysis, shot.player)} · ` +
        `${shotTypeLabel(shot.type)} → ${cellLabel(shot.cell)}`
      : hasShotTypes
        ? "Play to see each shot classified as it happens."
        : "Skeletons follow both players as the clip plays.";

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Match video</Text>
      <View style={styles.videoBox} onLayout={handleLayout}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
        />
        {tracks !== null && (
          <PoseOverlay frame={frame} videoSize={analysis.video} boxSize={boxSize} />
        )}
      </View>
      {tracks !== null && (
        <View style={styles.legend}>
          {analysis.players.map((entry) => (
            <View key={entry.id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: PLAYER_COLORS[entry.id] }]} />
              <Text style={styles.legendLabel}>{entry.label}</Text>
            </View>
          ))}
        </View>
      )}
      {followsPlayhead && (
        <Text style={styles.nowPlaying} numberOfLines={1}>
          {readout}
        </Text>
      )}
    </View>
  );
}

function playerLabel(analysis: MatchAnalysis, id: PlayerId): string {
  return analysis.players.find((entry) => entry.id === id)?.label ?? `Player ${id}`;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  heading: { ...type.label, color: colors.text },
  videoBox: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    overflow: "hidden",
  },
  legend: { flexDirection: "row", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...type.caption, color: colors.textDim },
  // Fixed height: the line swaps between hint and shot on every contact, and a
  // reflowing card under a playing video is distracting.
  nowPlaying: { ...type.captionStrong, color: colors.accentText, height: 18, lineHeight: 18 },
});
