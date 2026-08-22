import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { formatClock } from "@/lib/format";
import { notifyWarning } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { sortChronologically } from "./aggregate";
import { formatIsoDay } from "./display";
import type { PlayerClip } from "./shape";

interface RecordingsListProps {
  playerName: string;
  clips: readonly PlayerClip[];
  /** Returns an error message, or null when the untag landed. */
  onUntag: (clipId: string) => Promise<string | null>;
}

/**
 * Every recording this player was named on, newest first (the aggregate
 * sorts oldest first for the maths), so every claim above can be traced to
 * the clips it came from. Remove takes the name off the clip — the analysis
 * itself stays wherever it was recorded — behind the app's Alert confirm.
 */
export function RecordingsList({ playerName, clips, onUntag }: RecordingsListProps) {
  const recent = useMemo(() => sortChronologically(clips).reverse(), [clips]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const minutes = Math.round(clips.reduce((sum, clip) => sum + clip.durationSec, 0) / 60);

  const confirmUntag = (clip: PlayerClip) => {
    const title = clip.title.length > 0 ? clip.title : "this recording";
    notifyWarning();
    Alert.alert(
      `Remove ${title} from ${playerName}?`,
      "The analysis stays in your library; only the name comes off.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setBusy(clip.id);
            setFailure(null);
            void onUntag(clip.id).then((message) => {
              setBusy(null);
              if (message !== null) setFailure(message);
            });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Recordings</Text>
        <Text style={styles.caption}>
          {clips.length} {clips.length === 1 ? "clip" : "clips"} · {minutes} min
        </Text>
      </View>
      {failure !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {failure}
        </Text>
      ) : null}
      {recent.map((clip) => {
        const { me, opponent } = clip.summary;
        const title = clip.title.length > 0 ? clip.title : "Untitled recording";
        const working = busy === clip.id;
        return (
          <Card key={clip.id} compact style={styles.rowCard}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={2}>
                {formatIsoDay(clip.playedAt)} · as {me.label} · {formatClock(clip.durationSec)} ·{" "}
                {clip.shots} {clip.shots === 1 ? "shot" : "shots"}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={2}>
                T-time {me.tTimePct.toFixed(0)}% · predictability{" "}
                {Math.round(me.predictability.score * 100)}%
                {opponent !== null ? ` · opponent T-time ${opponent.tTimePct.toFixed(0)}%` : ""}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${title} from ${playerName}`}
              accessibilityState={{ disabled: working }}
              disabled={working}
              hitSlop={spacing.sm}
              onPress={() => confirmUntag(clip)}
              style={({ pressed }) => [styles.rowAction, pressed && styles.pressed, working && styles.disabled]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  error: { ...type.caption, color: colors.danger },
  rowCard: { flexDirection: "row", alignItems: "center" },
  rowText: { flex: 1, gap: 2, paddingLeft: spacing.xs },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textDim },
  rowAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
