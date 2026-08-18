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
  /**
   * The side the court-watcher thinks hit last, lit up so confirming is one
   * tap. The buttons themselves are unchanged: this is a suggestion painted
   * ONTO the manual controls, never a separate confirm control, so correcting
   * it costs exactly one tap on the other button and refereeing by hand never
   * becomes a mode you have to leave.
   */
  suggested?: Side | null;
  onWin: (side: Side) => void;
  disabled?: boolean;
}

export function RallyButtons({
  names,
  server,
  suggested = null,
  onWin,
  disabled = false,
}: RallyButtonsProps) {
  return (
    <View style={styles.row}>
      {SIDES.map((side) => {
        const isSuggested = suggested === side;
        return (
          <Pressable
            key={side}
            accessibilityRole="button"
            // Unchanged by the suggestion on purpose — this label is how a
            // VoiceOver user finds the button, and it must not move under them
            // between rallies. The suggestion rides on the hint instead.
            accessibilityLabel={`${names[side]} won the rally`}
            accessibilityHint={
              isSuggested
                ? "Suggested by the camera. Tap to confirm, or tap the other player."
                : undefined
            }
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => {
              tapMedium();
              onWin(side);
            }}
            style={({ pressed }) => [
              styles.button,
              isSuggested && styles.buttonSuggested,
              pressed && styles.buttonPressed,
              disabled && styles.buttonDisabled,
            ]}
          >
            {({ pressed }) => (
              <>
                <Text
                  style={[styles.name, (pressed || isSuggested) && styles.textPressed]}
                  numberOfLines={2}
                >
                  {names[side]}
                </Text>
                <Text
                  style={[styles.caption, (pressed || isSuggested) && styles.textPressed]}
                  numberOfLines={1}
                >
                  {isSuggested
                    ? "suggested · tap to confirm"
                    : server === side
                      ? "serving · won rally"
                      : "won rally"}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
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
  // The suggested side wears the same accent fill a press does — "already
  // half-chosen, waiting on you". Anything subtler is not findable at a glance
  // from a metre away, which is the only distance this screen is read from.
  buttonSuggested: { backgroundColor: colors.accent },
  buttonDisabled: { opacity: 0.35 },
  name: { ...type.title, color: colors.text, textAlign: "center" },
  caption: { ...type.caption, color: colors.textDim },
  // The pressed fill is the accent, which only ever carries ink text (tokens.ts).
  textPressed: { color: colors.onAccent },
});
