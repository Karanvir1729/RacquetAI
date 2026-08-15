import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  /** Optional count badge (e.g. recordings awaiting scoring). Hidden when falsy. */
  badge?: number;
}

interface SegmentedProps<K extends string> {
  options: readonly SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
}

/**
 * The one segmented control: accent active pill, 44pt tap targets, label bumps
 * weight when active. Shared by every tab that filters a list so adjacent
 * screens render an identical control.
 */
export function Segmented<K extends string>({ options, value, onChange }: SegmentedProps<K>) {
  // Up to four segments share the width evenly. Beyond that the labels no
  // longer fit an iPhone and start wrapping mid-word, so the row scrolls
  // instead and each label keeps its own width on one line.
  const scrollable = options.length > 4;

  const segments = options.map((item) => {
    const active = item.key === value;
    return (
      <Pressable
        key={item.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        // Without the count the badge is invisible to VoiceOver, and the badge
        // is the only signal that items need attention.
        accessibilityLabel={
          item.badge
            ? `${item.label} section, ${item.badge} needing attention`
            : `${item.label} section`
        }
        onPress={() => {
          if (!active) selectionHaptic();
          onChange(item.key);
        }}
        style={[
          styles.segment,
          scrollable ? styles.segmentIntrinsic : null,
          active && styles.segmentActive,
        ]}
      >
        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={1}>
          {item.label}
        </Text>
        {item.badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badge}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  });

  if (!scrollable) {
    return (
      <View style={styles.segments} accessibilityRole="tablist">
        {segments}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The pill frame belongs to the ScrollView itself, not to the scrolling
      // content — on the content it slides out of view and the rounded right
      // edge is clipped mid-scroll.
      style={styles.segmentsFrame}
      contentContainerStyle={styles.segmentsContent}
      accessibilityRole="tablist"
    >
      {segments}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    padding: spacing.xs,
  },
  segmentsFrame: {
    flexGrow: 0,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  segmentsContent: { flexDirection: "row", gap: spacing.xs, padding: spacing.xs },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.pill,
  },
  // Intrinsic width so a scrolling row shows each label in full.
  segmentIntrinsic: { flex: 0, paddingHorizontal: spacing.md },
  segmentActive: { backgroundColor: colors.accent },
  segmentLabel: { ...type.label, color: colors.textDim },
  segmentLabelActive: { color: colors.onAccent, fontWeight: "800" },
  badge: {
    minWidth: 16,
    // minHeight, not height: the numeral scales with Dynamic Type and would
    // otherwise be clipped by a fixed 16pt box at accessibility sizes.
    minHeight: 16,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: colors.onAccent },
});
