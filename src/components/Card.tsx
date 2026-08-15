import { PropsWithChildren } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { cardShadow, colors, radius, spacing } from "@/theme/tokens";

interface CardProps {
  style?: ViewStyle | ViewStyle[];
  /**
   * Tighter padding for dense list rows (recording rows, settings links) while
   * keeping the same fill, radius, and shadow — so every card surface matches.
   */
  compact?: boolean;
}

/** The uniform card recipe: rounded, hairline border, faint fill, deep shadow. */
export function Card({ children, style, compact = false }: PropsWithChildren<CardProps>) {
  return <View style={[styles.card, compact && styles.compact, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...cardShadow,
  },
  compact: { padding: spacing.sm },
});
