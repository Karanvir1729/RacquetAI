import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, CONTENT_MAX_WIDTH } from "@/theme/layout";
import { colors, radius, spacing, type } from "@/theme/tokens";

/**
 * The Library's door into player profiles: the same compact icon-tile row the
 * Library's other cards use (Score keeper, Demo, Import), docked under the
 * list so it is on screen whatever the list holds. The Library route composes
 * it around the Library screen rather than the screen importing it — the
 * roster is the player feature's, and routes are where features meet
 * (docs/01 rule 1). Navigates by route only.
 */
export function PlayersEntryCard() {
  return (
    <View style={styles.dock}>
      <Card compact style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open players — profiles of the people in your footage"
          onPress={() => {
            selectionHaptic();
            router.push("/players");
          }}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          <View style={styles.icon}>
            <Ionicons name="people" size={20} color={colors.onAccent} />
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              Players
            </Text>
            <Text style={styles.caption} numberOfLines={2}>
              Name the people in your footage; every read-out they are in pools into a profile.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    ...column(CONTENT_MAX_WIDTH),
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
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
