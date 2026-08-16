import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, type } from "@/theme/tokens";

import { cellLabel, formatPercent } from "./format";
import type { Placement } from "./types";

interface PlacementGridProps {
  placement: Placement;
  /** The player's total shots — quadrant shares are computed against this. */
  shots: number;
}

/** Row-major quadrant order with the front wall at the top, matching the heatmap. */
const CELL_ROWS = [
  ["frontLeft", "frontRight"],
  ["backLeft", "backRight"],
] as const;

/**
 * 2x2 shot-placement grid (the contract's court quadrants): count + share per
 * quadrant, front wall at the top like every court view on the screen.
 */
export function PlacementGrid({ placement, shots }: PlacementGridProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Shot placement</Text>
      <Text style={styles.wall}>Front wall</Text>
      <View style={styles.grid}>
        {CELL_ROWS.map((row) => (
          <View key={row[0]} style={styles.row}>
            {row.map((cell) => (
              <View key={cell} style={styles.cell}>
                <Text style={styles.count}>{placement[cell]}</Text>
                <Text style={styles.share}>
                  {formatPercent(shots > 0 ? placement[cell] / shots : 0)}
                </Text>
                <Text style={styles.name}>{cellLabel(cell)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  heading: { ...type.label, color: colors.text },
  wall: { ...type.caption, color: colors.textFaint, textAlign: "center" },
  grid: { gap: spacing.xs },
  row: { flexDirection: "row", gap: spacing.xs },
  cell: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  count: { ...type.heading, color: colors.text },
  share: { ...type.captionStrong, color: colors.accentText },
  name: { ...type.caption, color: colors.textDim },
});
