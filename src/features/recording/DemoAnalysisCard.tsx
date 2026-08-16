import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

/**
 * Persistent "Sample" teaser above the Library list (and in the empty state):
 * opens the bundled demo match analysis so the feature is discoverable before
 * the pipeline has processed any of the user's own footage. The accent-soft
 * fill and Sample badge keep it from reading as a real recording. Navigates by
 * route only — no import from features/analysis (docs/01 rule 2).
 */
export function DemoAnalysisCard() {
  return (
    <Card compact style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open demo match analysis, sample data"
        onPress={() => {
          selectionHaptic();
          router.push({ pathname: "/analysis", params: { source: "demo" } });
        }}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <Ionicons name="analytics" size={20} color={colors.onAccent} />
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              Demo match analysis
            </Text>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>Sample</Text>
            </View>
          </View>
          <Text style={styles.caption} numberOfLines={2}>
            Placement, court coverage and predictability from a sample squash match.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.accentSoft, borderColor: colors.line2 },
  body: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  badgeLabel: { ...type.captionStrong, color: colors.onAccent },
  caption: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
