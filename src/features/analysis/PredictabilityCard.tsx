import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, type } from "@/theme/tokens";

import { formatPercent, prettyPattern } from "./format";
import type { Predictability } from "./types";

interface PredictabilityCardProps {
  predictability: Predictability;
}

/**
 * How predictable a player's shot selection is: headline score (100% = an
 * opponent could always guess the next cell), the most common pattern in plain
 * English, and the entropy measurement behind the score for players who want
 * the receipt.
 */
export function PredictabilityCard({ predictability }: PredictabilityCardProps) {
  const { score, entropyBits, maxEntropyBits, topPattern } = predictability;
  const pct = Math.min(100, Math.max(0, Math.round(score * 100)));
  return (
    <View style={styles.wrap}>
      <View style={styles.scoreRow}>
        <Text style={styles.heading}>Predictability</Text>
        <Text style={styles.score}>{formatPercent(score)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.pattern}>Most common pattern: {prettyPattern(topPattern)}</Text>
      <Text style={styles.detail}>
        Shot-choice entropy {entropyBits.toFixed(1)} of {maxEntropyBits.toFixed(1)} bits — lower
        means easier to read.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  scoreRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  heading: { ...type.label, color: colors.text },
  score: { ...type.title, color: colors.accentText },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.data },
  pattern: { ...type.body, color: colors.text },
  detail: { ...type.caption, color: colors.textDim },
});
