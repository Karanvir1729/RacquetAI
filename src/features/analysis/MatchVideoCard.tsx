/**
 * Inline player for the analysis page's source video. Mounted only when a
 * video URI exists for the analysis (the hook must run unconditionally, so
 * the conditional lives at the call site, not here). Same expo-video pattern
 * as the Library's PlayerModal, but inline and paused by default.
 */
import { useVideoPlayer, VideoView } from "expo-video";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, type } from "@/theme/tokens";

interface MatchVideoCardProps {
  videoUri: string;
}

export function MatchVideoCard({ videoUri }: MatchVideoCardProps) {
  const player = useVideoPlayer(videoUri, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Match video</Text>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  heading: { ...type.label, color: colors.text },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    overflow: "hidden",
  },
});
