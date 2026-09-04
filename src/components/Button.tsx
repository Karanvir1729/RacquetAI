import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { selection as selectionHaptic, tapMedium } from "@/lib/haptics";
import { accentGlow, colors, MIN_TOUCH_TARGET, radius, spacing } from "@/theme/tokens";

interface ButtonProps {
  label: string;
  /** A fuller accessible name when the visible label is generic ("Show…"). */
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  /**
   * Override the variant's default tap feedback. Use `"none"` when the press
   * immediately raises a system Alert or fires its own notification haptic, so
   * the user never feels two buzzes stacked on one tap.
   */
  haptic?: "impact" | "selection" | "none";
}

/**
 * App buttons: accent fill with ink text for the primary action, hairline
 * ghost on the dark canvas for secondary, soft red for destructive.
 */
export function Button({
  label,
  accessibilityLabel,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  haptic,
}: ButtonProps) {
  const inactive = disabled || loading;
  // Committing actions get a medium impact; ghost/secondary presses get a light
  // selection tick. Blanket-medium on every button reads as noise (Apple HIG:
  // haptics must stay meaningful).
  const feedback = haptic ?? (variant === "secondary" ? "selection" : "impact");
  const handlePress = () => {
    if (feedback === "impact") tapMedium();
    else if (feedback === "selection") selectionHaptic();
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={handlePress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        variant === "primary" && !inactive ? styles.primaryGlow : null,
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.accent : colors.onAccent} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "secondary" && styles.labelSecondary,
            variant === "danger" && styles.labelDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET + 6,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primary: { backgroundColor: colors.accent },
  // Applied conditionally (primary && !inactive), which is what a static
  // boxShadow needs — the Android string has no shadowOpacity: 0 escape.
  primaryGlow: accentGlow(0.45, 18, 6),
  danger: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  secondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  disabled: { opacity: 0.4 },
  label: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2, color: colors.onAccent },
  labelSecondary: { color: colors.text, fontWeight: "600" },
  labelDanger: { color: colors.danger, fontWeight: "600" },
});
