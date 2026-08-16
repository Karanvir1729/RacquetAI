import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, type } from "@/theme/tokens";

import { heatOpacity } from "./format";
import type { CoverageHeatmap } from "./types";

interface CoverageGridProps {
  heatmap: CoverageHeatmap;
}

/**
 * Court-coverage heatmap: rows x cols cells tinted by normalized presence.
 * Tint is the accent token at interpolated opacity — no computed hex — so the
 * map restyles itself with the palette on both themes. Row 0 renders at the
 * top = front wall (contract order), and square cells keep the 8x12 grid at a
 * squash court's 2:3 footprint.
 */
export function CoverageGrid({ heatmap }: CoverageGridProps) {
  const { rows, cols, values } = heatmap;
  const rowSlices = Array.from({ length: rows }, (_, row) =>
    values.slice(row * cols, (row + 1) * cols),
  );
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Court coverage</Text>
      <Text style={styles.wall}>Front wall</Text>
      <View style={styles.grid}>
        {rowSlices.map((rowValues, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {rowValues.map((value, colIndex) => (
              <View key={colIndex} style={[styles.cell, { opacity: heatOpacity(value) }]} />
            ))}
          </View>
        ))}
        {/* Short line at 5.44m of the 9.75m court, front wall at the top. */}
        <View pointerEvents="none" style={styles.shortLine} />
      </View>
      <Text style={styles.legend}>Brighter = more time spent there</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  heading: { ...type.label, color: colors.text },
  wall: { ...type.caption, color: colors.textFaint, textAlign: "center" },
  grid: { width: "100%", maxWidth: 220, alignSelf: "center", gap: 2 },
  row: { flexDirection: "row", gap: 2 },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 3, backgroundColor: colors.accent },
  shortLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "55.8%",
    height: 1,
    backgroundColor: colors.line2,
  },
  legend: { ...type.caption, color: colors.textFaint, textAlign: "center" },
});
