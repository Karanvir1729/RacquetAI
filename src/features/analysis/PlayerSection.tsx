import { useMemo, type ReactNode } from "react";
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
  /**
   * Rendered in the header row beside the label — the "name this player"
   * control (features/players) when the screen knows which recording it is
   * showing. Optional so the demo and a bare read-out render unchanged.
   */
  headerExtra?: ReactNode;
}

/**
 * One player's full read-out on a single card: header stats (shots + T-time),
 * the shot-type breakdown, placement quadrants, coverage heatmap, and the
 * predictability block.
 */
export function PlayerSection({ player, shots, headerExtra }: PlayerSectionProps) {
  // Empty on a v1 analysis (no shot types anywhere) — the line disappears
  // rather than showing a row of zeroes.
  const breakdown = useMemo(
    () => formatShotTypeBreakdown(countShotTypes(shots, player.id)),
    [shots, player.id],
  );

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{player.label}</Text>
          {headerExtra}
        </View>
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
  // Label left, the optional control right; wraps on a narrow phone so a long
  // label ("Player A (lighter shirt)") never squeezes the control to nothing.
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  label: { ...type.heading, color: colors.text, flexShrink: 1 },
  meta: { ...type.caption, color: colors.textDim },
  types: { ...type.captionStrong, color: colors.accentText },
  divider: { height: 1, backgroundColor: colors.line },
});
