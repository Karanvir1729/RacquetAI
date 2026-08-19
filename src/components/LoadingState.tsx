import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, spacing, type } from "@/theme/tokens";

interface LoadingStateProps {
  /** Reassuring copy under the spinner (e.g. "Loading your matches…"). */
  caption?: string;
  /**
   * Fill the parent and centre (cold-open full-screen state). When false the
   * block sits inline within a scrolling section.
   */
  fill?: boolean;
}

/**
 * The one loading primitive: spinner + optional copy, so every tab's first
 * paint reads the same instead of a bare unlabelled spinner.
 */
export function LoadingState({ caption, fill = false }: LoadingStateProps) {
  return (
    <View style={[styles.wrap, fill && styles.fill]}>
      <ActivityIndicator color={colors.accentText} />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  fill: { flex: 1, backgroundColor: colors.bg },
  caption: { ...type.caption, color: colors.textDim, textAlign: "center" },
});
