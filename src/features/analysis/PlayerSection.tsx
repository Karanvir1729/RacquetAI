import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

import { CoverageGrid } from "./CoverageGrid";
import { formatPercent, formatShotTypeBreakdown } from "./format";
import { PlacementGrid } from "./PlacementGrid";
import { PredictabilityCard } from "./PredictabilityCard";
import { countShotTypes } from "./shots";
import type { PlayerAnalysis, ShotEvent } from "./types";

interface PlayerSectionProps {
  player: PlayerAnalysis;
  /** The whole match's shots — the type breakdown is filtered out of them. */
  shots: ShotEvent[];
}

/**
 * One player's full read-out on a single card: header stats (shots + T-time),
 * the shot-type breakdown, placement quadrants, coverage heatmap, and the
 * predictability block.
 */
export function PlayerSection({ player, shots }: PlayerSectionProps) {
  // Empty on a v1 analysis (no shot types anywhere) — the line disappears
  // rather than showing a row of zeroes.
  const breakdown = useMemo(
    () => formatShotTypeBreakdown(countShotTypes(shots, player.id)),
    [shots, player.id],
  );

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{player.label}</Text>
        <Text style={styles.meta}>
          {/* tTimePct is already 0..100 per the contract — divide before formatting. */}
          {player.shots} shots · at the T {formatPercent(player.tTimePct / 100)} of the time
        </Text>
        {breakdown.length > 0 && <Text style={styles.types}>{breakdown}</Text>}
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
  types: { ...type.captionStrong, color: colors.accentText },
  divider: { height: 1, backgroundColor: colors.line },
});
