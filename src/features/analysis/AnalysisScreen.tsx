import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { readAnalysisVideoRef } from "@/lib/analysisVideo";
import { formatClock } from "@/lib/format";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

import { DEMO_ANALYSIS } from "./demoAnalysis";
import { MatchVideoCard } from "./MatchVideoCard";
import { PlayerSection } from "./PlayerSection";
import { QualityFootnote } from "./QualityFootnote";
import { RallyStatsRow } from "./RallyStatsRow";
import { loadAnalysisForRecording } from "./storage";
import type { MatchAnalysis } from "./types";

interface AnalysisScreenProps {
  /** "demo" shows the bundled sample; otherwise `recordingId` names the source. */
  source?: string;
  recordingId?: string;
}

/**
 * Match Analysis: per-player placement quadrants, coverage heatmap and
 * predictability, framed by match-level rally stats and the quality small
 * print. Data is either the bundled demo (Library "Sample" card) or a
 * recording's `<id>.analysis.json` sidecar, parsed defensively — a corrupt
 * file gets the error state, never a crash.
 */
export function AnalysisScreen({ source, recordingId }: AnalysisScreenProps) {
  const isDemo = source === "demo";
  const analysis = useMemo<MatchAnalysis | null>(
    () => (isDemo ? DEMO_ANALYSIS : recordingId ? loadAnalysisForRecording(recordingId) : null),
    [isDemo, recordingId],
  );
  // The demo ships stats only; imported analyses may carry a copy of the clip.
  const videoUri = useMemo(
    () => (!isDemo && recordingId ? readAnalysisVideoRef(recordingId) : null),
    [isDemo, recordingId],
  );

  const goBack = () => {
    selectionHaptic();
    // Deep links can land here with no history — fall back to the Library tab.
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Library"
        onPress={goBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={18} color={colors.accentText} />
        <Text style={styles.backLabel}>Library</Text>
      </Pressable>
      <ScreenHeader
        title="Match analysis"
        subtitle={
          analysis
            ? `${isDemo ? "Sample match" : "Your recording"} · ` +
              `${formatClock(analysis.video.durationSec)} of footage`
            : "Match analysis"
        }
      />
      {analysis === null ? (
        <View style={styles.centerFill}>
          <EmptyState
            icon="analytics-outline"
            iconColor={colors.danger}
            title="Analysis not available"
            caption="This recording has no readable analysis yet. Analyses appear here once the pipeline has processed the footage."
          />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {videoUri !== null && <MatchVideoCard videoUri={videoUri} analysis={analysis} />}
          <RallyStatsRow rallies={analysis.rallies} />
          {analysis.players.map((player) => (
            <PlayerSection key={player.id} player={player} shots={analysis.shots} />
          ))}
          <QualityFootnote quality={analysis.quality} />
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  backLabel: { ...type.label, color: colors.accentText },
  centerFill: { flex: 1, justifyContent: "center", padding: spacing.md },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  pressed: { opacity: 0.7 },
});
