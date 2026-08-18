/**
 * The Score keeper's chrome: the row above the board (leave, mute) and the row
 * below the rally buttons (undo, appeals, and either "new match" or "stop
 * watching").
 *
 * Split out of RefereeScreen so that file stays about composition rather than
 * about pressable geometry. Two rules survive the move:
 *
 * - **Undo never moves and is never more than one tap.** It sits first in the
 *   action row in every mode, watching or not, because it is the control
 *   somebody reaches for while annoyed and out of breath.
 * - **The mute toggle is hidden outright when speech is unavailable.** A toggle
 *   that cannot change anything is worse than no toggle.
 */
import { Ionicons } from "@expo/vector-icons";
import { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

interface TopRowProps {
  muted: boolean;
  /** False in a build without expo-speech — the toggle disappears entirely. */
  speechAvailable: boolean;
  onToggleMute: () => void;
  onBack: () => void;
}

export function TopRow({ muted, speechAvailable, onToggleMute, onBack }: TopRowProps) {
  return (
    <View style={styles.topRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Library"
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={18} color={colors.accentText} />
        <Text style={styles.backLabel}>Library</Text>
      </Pressable>
      {speechAvailable ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: !muted }}
          accessibilityLabel={muted ? "Turn score announcements on" : "Mute score announcements"}
          onPress={() => {
            selectionHaptic();
            onToggleMute();
          }}
          style={({ pressed }) => [styles.mute, pressed && styles.pressed]}
        >
          <Ionicons
            name={muted ? "volume-mute" : "volume-high"}
            size={20}
            color={muted ? colors.textFaint : colors.accentText}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

interface ActionRowProps {
  canUndo: boolean;
  matchOver: boolean;
  /** True while the camera is on: the third slot becomes "stop watching". */
  watching: boolean;
  onUndo: () => void;
  onAppeal: () => void;
  onNewMatch: () => void;
  onStopWatching: () => void;
}

export function ActionRow({
  canUndo,
  matchOver,
  watching,
  onUndo,
  onAppeal,
  onNewMatch,
  onStopWatching,
}: ActionRowProps) {
  return (
    <View style={styles.actions}>
      <ActionButton icon="arrow-undo" label="Undo" onPress={onUndo} disabled={!canUndo} />
      <ActionButton icon="hand-left" label="Let…" onPress={onAppeal} disabled={matchOver} />
      {/* Three slots is what fits at 375pt. While watching, turning the camera
          off outranks starting a new match — a new match is one stop away, and
          a camera nobody can turn off is a battery complaint. */}
      {watching ? (
        <ActionButton icon="eye-off" label="Stop watching" onPress={onStopWatching} />
      ) : matchOver ? null : (
        <ActionButton icon="refresh" label="New match" onPress={onNewMatch} />
      )}
    </View>
  );
}

interface ActionButtonProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

/** Secondary courtside action: small, but still a full 44pt target. */
function ActionButton({ icon, label, onPress, disabled = false }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.pressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
  },
  backLabel: { ...type.label, color: colors.accentText },
  mute: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  actionDisabled: { opacity: 0.35 },
  actionLabel: { ...type.label, color: colors.text },
  pressed: { opacity: 0.7 },
});
