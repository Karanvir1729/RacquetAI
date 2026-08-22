import { StyleSheet, Text } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

interface StatTileProps {
  value: string;
  label: string;
  /** One line under the label — what the number rests on, or how to read it. */
  hint?: string;
}

/**
 * A headline figure on a profile: the same tile recipe the read-out's rally
 * row uses (features/analysis/RallyStatsRow), so a profile's numbers and a
 * single read-out's read as one app. That tile is private to its row, hence
 * the recipe rather than the component; the hint line is the one addition —
 * a pooled number needs to say what it was pooled over.
 */
export function StatTile({ value, label, hint }: StatTileProps) {
  return (
    <Card compact style={styles.tile}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.md },
  value: { ...type.title, color: colors.accentText },
  label: { ...type.caption, color: colors.textDim, textAlign: "center" },
  hint: { ...type.caption, color: colors.textDim, textAlign: "center" },
});
