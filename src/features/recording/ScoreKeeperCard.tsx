/**
 * Library card that opens the courtside Score keeper (/referee) — the same
 * screen as the Referee tab, kept here as a second door into it.
 *
 * Lives in features/recording because the Library owns it, and navigates by
 * route only — no import from features/scoring internals (docs/01 rule 2),
 * same as DemoAnalysisCard and ImportAnalysisCard.
 *
 * The copy is careful: this is a scoreboard you tap, not a camera that watches
 * the match. Anything that implied the app was scoring by itself would be a
 * promise the app cannot keep.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

export function ScoreKeeperCard() {
  return (
    <Card compact style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the score keeper — tap who won each rally and hear the score called out"
        onPress={() => {
          selectionHaptic();
          router.push("/referee?from=library");
        }}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <Ionicons name="megaphone" size={20} color={colors.onAccent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            Score keeper
          </Text>
          <Text style={styles.caption} numberOfLines={2}>
            Tap who won each rally. It keeps a PAR-11 squash score and calls it out loud.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.cardRaised, borderColor: colors.line2 },
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
  title: { ...type.bodyStrong, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
