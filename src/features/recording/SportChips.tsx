import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { sportLabel } from "./display";
import { SPORTS, type Sport } from "./types";

interface SportChipsProps {
  value: Sport;
  onChange: (sport: Sport) => void;
}

/**
 * Sport tag picker floating over the camera preview. Nothing is required:
 * the tag defaults to "unspecified", tapping a chip tags the next take, and
 * tapping the active chip again clears back to untagged. Squash leads the row
 * — it's the sport the app is built for.
 */
export function SportChips({ value, onChange }: SportChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Frame the scroller, not the content, so the row hugs its chips.
      style={styles.frame}
      contentContainerStyle={styles.row}
    >
      {SPORTS.map((sport) => {
        const active = sport === value;
        return (
          <Pressable
            key={sport}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              active
                ? `Remove ${sportLabel(sport)} tag`
                : `Tag next recording as ${sportLabel(sport)}`
            }
            onPress={() => {
              selectionHaptic();
              onChange(active ? "unspecified" : sport);
            }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {sportLabel(sport)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frame: { flexGrow: 0 },
  row: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { ...type.label, color: colors.text },
  labelActive: { color: colors.onAccent, fontWeight: "800" },
});
