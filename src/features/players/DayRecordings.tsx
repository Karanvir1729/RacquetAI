import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatClock } from "@/lib/format";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

import { formatIsoDay, recordingsWord } from "./display";
import type { PlayerClip } from "./shape";

interface DayRecordingsProps {
  /** YYYY-MM-DD — the calendar square that was tapped. */
  date: string;
  /** That day's clips (`clipsOnDay`, computed by the screen), oldest tag first. */
  clips: readonly PlayerClip[];
  onClose: () => void;
}

/**
 * What a tapped calendar square was: the recordings played that day, listed
 * under the grid inside the same card. A dark square says "three matches";
 * this says which three, so a coach can go from "they played a lot in June"
 * to the actual footage without hunting the recordings list by date. Each row
 * carries the same line the recordings list prints — side, length, shots,
 * T-time, predictability — so the two read as one thing.
 *
 * An empty day is still a finding ("No recordings on…"), not a blank, because
 * the square was tappable and silence would read as a broken tap.
 */
export function DayRecordings({ date, clips, onClose }: DayRecordingsProps) {
  const when = formatIsoDay(date);
  const heading =
    clips.length === 0 ? `No recordings on ${when}` : `${when} — ${recordingsWord(clips.length)}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.hairline} />
      <View style={styles.headingRow}>
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${when}`}
          hitSlop={spacing.sm}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={styles.closeLabel}>Close</Text>
        </Pressable>
      </View>

      {clips.map((clip) => {
        const { me } = clip.summary;
        const title = clip.title.length > 0 ? clip.title : "Untitled recording";
        return (
          <View key={clip.id} style={styles.row}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={2}>
              as {me.label} · {formatClock(clip.durationSec)} · {clip.shots}{" "}
              {clip.shots === 1 ? "shot" : "shots"} · T-time {me.tTimePct.toFixed(0)}% · predictability{" "}
              {Math.round(me.predictability.score * 100)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  hairline: { height: 1, backgroundColor: colors.line },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  heading: { ...type.label, color: colors.text, flexShrink: 1 },
  close: { minHeight: MIN_TOUCH_TARGET - spacing.md, justifyContent: "center", paddingHorizontal: spacing.xs },
  closeLabel: { ...type.label, color: colors.accentText },
  pressed: { opacity: 0.7 },
  row: { gap: 2 },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textDim },
});
