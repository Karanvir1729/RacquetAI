import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { hasAnalysisSidecar } from "@/lib/analysisSidecar";
import { formatBytes, formatClock } from "@/lib/format";
import { notifyWarning, selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { DemoAnalysisCard } from "./DemoAnalysisCard";
import { formatRecordedAt, sportLabel } from "./display";
import { ImportAnalysisCard } from "./ImportAnalysisCard";
import { ImportedAnalysesSection } from "./ImportedAnalysesSection";
import { PlayerModal } from "./PlayerModal";
import { deleteRecording } from "./storage";
import { useRecordings } from "./useRecordings";
import type { RecordingEntry } from "./types";

/**
 * The Library tab: recordings newest-first, tap to play (PlayerModal), trash
 * to delete after a confirm, plus the persistent demo-analysis teaser and a
 * "View analysis" affordance on takes the pipeline has processed. The list
 * re-reads the filesystem on every tab focus (useRecordings), so takes saved
 * on the Record tab just appear.
 */
export function LibraryScreen() {
  const { status, recordings, reload } = useRecordings();
  const [playing, setPlaying] = useState<RecordingEntry | null>(null);

  const confirmDelete = (entry: RecordingEntry) => {
    notifyWarning();
    Alert.alert(
      "Delete recording?",
      `${formatRecordedAt(entry.meta.createdAt)} · ${formatClock(entry.meta.durationSec)}. ` +
        "This removes the video from the app permanently.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            try {
              deleteRecording(entry.meta.id);
            } catch {
              Alert.alert("Couldn't delete", "The recording could not be removed. Try again.");
            }
            reload();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="Library"
        subtitle={
          status === "ready" && recordings.length > 0
            ? `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`
            : "Your recorded matches"
        }
      />
      {status === "loading" ? (
        <LoadingState fill caption="Loading your matches…" />
      ) : status === "error" ? (
        <View style={styles.centerFill}>
          <EmptyState
            icon="alert-circle-outline"
            iconColor={colors.danger}
            title="Couldn't read recordings"
            caption="Something went wrong reading the recordings folder. Switch tabs and back to retry."
          />
        </View>
      ) : recordings.length === 0 ? (
        // The demo teaser stays visible even with zero recordings — it is the
        // only way to see what analysis looks like before recording anything.
        // Import & analyze sits beside it: analyzing existing footage needs no
        // recordings at all.
        <View style={styles.emptyWrap}>
          <DemoAnalysisCard />
          <ImportAnalysisCard />
          <ImportedAnalysesSection />
          <View style={styles.emptyCenter}>
            <EmptyState
              icon="film-outline"
              title="No matches yet"
              caption="Recordings you capture on the Record tab land here for playback and, later, scoring."
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={recordings}
          keyExtractor={(entry) => entry.meta.id}
          style={styles.flatList}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <DemoAnalysisCard />
              <ImportAnalysisCard />
              <ImportedAnalysesSection />
            </View>
          }
          renderItem={({ item }) => (
            <RecordingRow
              entry={item}
              onPlay={() => {
                selectionHaptic();
                setPlaying(item);
              }}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      )}
      {playing !== null ? <PlayerModal entry={playing} onClose={() => setPlaying(null)} /> : null}
    </Screen>
  );
}

interface RecordingRowProps {
  entry: RecordingEntry;
  onPlay: () => void;
  onDelete: () => void;
}

/**
 * One Library row: tap to play, swipe left for the Delete underlay, with the
 * trash icon kept as the discoverable path to the same confirmed delete. Rows
 * whose recording has an `<id>.analysis.json` sidecar (dropped by the analysis
 * pipeline) also get a View-analysis affordance.
 */
function RecordingRow({ entry, onPlay, onDelete }: RecordingRowProps) {
  const title = formatRecordedAt(entry.meta.createdAt);
  const analyzed = hasAnalysisSidecar(entry.meta.id);
  return (
    <Swipeable
      overshootRight={false}
      friction={2}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete recording, ${title}`}
          onPress={onDelete}
          style={({ pressed }) => [styles.swipeDelete, pressed && styles.pressed]}
        >
          <Ionicons name="trash" size={20} color={colors.danger} />
          <Text style={styles.swipeDeleteLabel}>Delete</Text>
        </Pressable>
      )}
    >
      <Card compact style={styles.rowCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Play recording, ${title}, ${formatClock(entry.meta.durationSec)}`}
          onPress={onPlay}
          style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
        >
          <View style={styles.thumb}>
            <Ionicons name="play" size={18} color={colors.onAccent} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {formatClock(entry.meta.durationSec)} · {formatBytes(entry.sizeBytes)} ·{" "}
              {sportLabel(entry.meta.sport)}
            </Text>
          </View>
        </Pressable>
        {analyzed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View analysis, ${title}`}
            hitSlop={spacing.sm}
            onPress={() => {
              selectionHaptic();
              router.push({ pathname: "/analysis", params: { id: entry.meta.id } });
            }}
            style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
          >
            <Ionicons name="analytics" size={18} color={colors.accentText} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete recording, ${title}`}
          hitSlop={spacing.sm}
          onPress={onDelete}
          style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      </Card>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, justifyContent: "center", padding: spacing.md },
  emptyWrap: { flex: 1, padding: spacing.md, gap: spacing.sm },
  emptyCenter: { flex: 1, justifyContent: "center" },
  flatList: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  listHeader: { gap: spacing.sm },
  rowCard: { flexDirection: "row", alignItems: "center" },
  rowBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textDim },
  rowAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDelete: {
    width: 88,
    marginLeft: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  swipeDeleteLabel: { ...type.captionStrong, color: colors.danger },
  pressed: { opacity: 0.7 },
});
