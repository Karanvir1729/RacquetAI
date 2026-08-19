/**
 * "Score a video": pick which analysed match to referee.
 *
 * It lists ANALYSES, not videos, because the rally split reads the shot stream
 * — a recording that was never analysed has nothing to referee and so is not
 * offered. The bundled demo is always last and always present, which is what
 * makes this half of the feature demonstrable on a Simulator, where there is
 * no camera, no library, and nothing else in the list.
 *
 * The warning above the list is not decoration. A scoreline folded from a
 * 72.7%-per-rally heuristic is wrong more often than it is right by the end of
 * a game, and this sheet is the last place to say so before a score appears
 * looking like a fact.
 */
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { formatRecordedAt } from "@/features/recording/display";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { rallyConfidence } from "./videoReferee";
import { VideoSource } from "./videoSources";

interface VideoPickerSheetProps {
  visible: boolean;
  /**
   * Read by the caller on the tap that opens this sheet, not by an effect in
   * here. Listing analyses touches the disk, and doing that in response to the
   * tap keeps it out of the render path — an analysis that finished a moment
   * ago is in the list either way, because the read happens on every open.
   */
  sources: VideoSource[];
  onPick: (source: VideoSource) => void;
  onClose: () => void;
}

function sourceTitle(source: VideoSource): string {
  if (source.kind === "demo") return "Demo match";
  if (source.createdAt === null) return "Analysed match";
  return formatRecordedAt(source.createdAt);
}

function sourceCaption(source: VideoSource): string {
  if (source.kind === "demo") return "Bundled sample footage — always available, no camera needed.";
  const kind = source.kind === "imported" ? "Imported analysis" : "Recorded on this phone";
  if (source.durationSec === null) return kind;
  const minutes = Math.floor(source.durationSec / 60);
  const seconds = source.durationSec % 60;
  return `${kind} · ${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function VideoPickerSheet({ visible, sources, onPick, onClose }: VideoPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const pct = Math.round(rallyConfidence * 100);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
        >
          <View style={styles.column}>
            <Text style={styles.title}>Score a video</Text>
            <Text style={styles.caption}>
              Every rally goes to whoever hit last — right {pct}% of the time on hand-labelled
              footage, and the mistakes add up down a scoreline. You get a draft to correct, not a
              result.
            </Text>

            {sources.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="film-outline" size={20} color={colors.textFaint} />
                <Text style={styles.emptyText}>
                  Nothing to score yet. Analyse a match from the Library first — refereeing reads
                  the shots the analysis found.
                </Text>
              </View>
            ) : (
              sources.map((source) => (
                <Pressable
                  key={`${source.kind}-${source.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Score ${sourceTitle(source)}`}
                  onPress={() => {
                    selectionHaptic();
                    onPick(source);
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Ionicons
                    name={source.kind === "demo" ? "sparkles" : "film"}
                    size={18}
                    color={colors.accent}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {sourceTitle(source)}
                    </Text>
                    <Text style={styles.rowCaption} numberOfLines={1}>
                      {sourceCaption(source)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </Pressable>
              ))
            )}

            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                selectionHaptic();
                onClose();
              }}
              haptic="none"
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  column: { ...column(FORM_MAX_WIDTH), gap: spacing.md },
  title: { ...type.title, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.label, color: colors.text },
  rowCaption: { ...type.caption, color: colors.textDim },
  empty: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  emptyText: { ...type.caption, color: colors.textDim, textAlign: "center" },
  pressed: { opacity: 0.7 },
});
