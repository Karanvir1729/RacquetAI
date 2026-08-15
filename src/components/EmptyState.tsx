import { Ionicons } from "@expo/vector-icons";
import { ColorValue, StyleSheet, Text, View } from "react-native";

import { colors, spacing, type } from "@/theme/tokens";

interface EmptyStateProps {
  /** Short headline (e.g. "No matches yet"). */
  title: string;
  /** Optional supporting copy explaining how the list fills up. */
  caption?: string;
  /**
   * Glyph for the state. Defaults to the sport mark; swap for a meaningful
   * glyph when the state says something more than "nothing here".
   */
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: ColorValue;
}

/**
 * The one empty-state primitive: faded glyph + headline + optional copy, so
 * "nothing here yet" reads identically everywhere instead of a lone line of
 * dim text on one screen and a bespoke icon block on the next.
 */
export function EmptyState({
  title,
  caption,
  icon = "tennisball-outline",
  iconColor = colors.accent,
}: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={32} color={iconColor} style={styles.icon} />
      <Text style={styles.title}>{title}</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  icon: { marginBottom: spacing.xs, opacity: 0.8 },
  title: { ...type.bodyStrong, color: colors.text, textAlign: "center" },
  caption: { ...type.caption, color: colors.textDim, textAlign: "center", maxWidth: 280 },
});
