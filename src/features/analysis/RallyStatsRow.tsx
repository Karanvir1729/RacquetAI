import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

import { formatCount } from "./format";
import type { RallyStats } from "./types";

interface RallyStatsRowProps {
  rallies: RallyStats;
}

/** The match-level rally numbers as three side-by-side stat tiles. */
export function RallyStatsRow({ rallies }: RallyStatsRowProps) {
  return (
    <View style={styles.row}>
      <StatTile value={formatCount(rallies.count)} label="Rallies" />
      <StatTile value={rallies.avgShotsPerRally.toFixed(1)} label="Avg shots / rally" />
      <StatTile value={formatCount(rallies.longestRally)} label="Longest rally" />
    </View>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <Card compact style={styles.tile}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.md },
  value: { ...type.title, color: colors.accentText },
  label: { ...type.caption, color: colors.textDim, textAlign: "center" },
});
