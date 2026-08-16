import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

import { CoverageGrid } from "./CoverageGrid";
import { formatPercent } from "./format";
import { PlacementGrid } from "./PlacementGrid";
import { PredictabilityCard } from "./PredictabilityCard";
import type { PlayerAnalysis } from "./types";

interface PlayerSectionProps {
  player: PlayerAnalysis;
}

/**
 * One player's full read-out on a single card: header stats (shots + T-time),
 * placement quadrants, coverage heatmap, and the predictability block.
 */
export function PlayerSection({ player }: PlayerSectionProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{player.label}</Text>
        <Text style={styles.meta}>
          {/* tTimePct is already 0..100 per the contract — divide before formatting. */}
          {player.shots} shots · at the T {formatPercent(player.tTimePct / 100)} of the time
        </Text>
      </View>
      <PlacementGrid placement={player.placement} shots={player.shots} />
      <View style={styles.divider} />
      <CoverageGrid heatmap={player.coverageHeatmap} />
      <View style={styles.divider} />
      <PredictabilityCard predictability={player.predictability} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { gap: 2 },
  label: { ...type.heading, color: colors.text },
  meta: { ...type.caption, color: colors.textDim },
  divider: { height: 1, backgroundColor: colors.line },
});
