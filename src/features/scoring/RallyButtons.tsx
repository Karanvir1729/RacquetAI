/**
 * The two taps the whole feature exists for: "who won that rally?".
 *
 * Deliberately enormous and pinned to the bottom of the screen — this is used
 * one-handed, sweating, between rallies, and a missed tap costs a point. Left
 * button is always side A, right is always side B, matching the scoreboard
 * above so the eye never has to re-map which half is whose.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";

import { tapMedium } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

import { PlayerNames } from "./announce";
import { Side, SIDES } from "./types";

interface RallyButtonsProps {
  names: PlayerNames;
  /** Marks the serving side, so the board and the buttons tell one story. */
  server: Side | null;
  onWin: (side: Side) => void;
  disabled?: boolean;
}

export function RallyButtons({ names, server, onWin, disabled = false }: RallyButtonsProps) {
  return (
    <View style={styles.row}>
      {SIDES.map((side) => (
        <Pressable
          key={side}
          accessibilityRole="button"
          accessibilityLabel={`${names[side]} won the rally`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            tapMedium();
            onWin(side);
          }}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            disabled && styles.buttonDisabled,
          ]}
        >
          {({ pressed }) => (
            <>
              <Text style={[styles.name, pressed && styles.textPressed]} numberOfLines={2}>
                {names[side]}
              </Text>
              <Text style={[styles.caption, pressed && styles.textPressed]} numberOfLines={1}>
                {server === side ? "serving · won rally" : "won rally"}
              </Text>
            </>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  button: {
    flex: 1,
    // Roughly a thumb-and-a-half tall: far above the 44pt minimum, because the
    // target has to be found without looking at it.
    minHeight: 132,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  // Inverted rather than dimmed: a tap this important should be unmistakable
  // even in peripheral vision.
  buttonPressed: { backgroundColor: colors.accent, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.35 },
  name: { ...type.title, color: colors.text, textAlign: "center" },
  caption: { ...type.caption, color: colors.textDim },
  // The pressed fill is the accent, which only ever carries ink text (tokens.ts).
  textPressed: { color: colors.onAccent },
});
