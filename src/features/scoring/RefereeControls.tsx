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
  /**
   * Null when the screen was opened from its own tab rather than pushed from
   * the Library card — there is nothing behind it, so the chevron is dropped
   * rather than left pointing at a screen the tap would not reach.
   */
  onBack: (() => void) | null;
}

export function TopRow({ muted, speechAvailable, onToggleMute, onBack }: TopRowProps) {
  return (
    <View style={styles.topRow}>
      {onBack === null ? (
        <View />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Library"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.backLabel}>Library</Text>
        </Pressable>
      )}
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
  /**
   * Autopilot's state, and null when this binary cannot watch at all. The
   * switch on the entry screen is out of reach once the camera takes it over,
   * and a machine that is scoring points a human cannot stop is the one state
   * this feature must never be in — so while watching, it also lives here.
   */
  autopilot: boolean | null;
  onToggleAutopilot: () => void;
  onUndo: () => void;
  onAppeal: () => void;
  onNewMatch: () => void;
  onStopWatching: () => void;
}

export function ActionRow({
  canUndo,
  matchOver,
  watching,
  autopilot,
  onToggleAutopilot,
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
      {/* A fourth slot, and only while it can matter: the row wraps, so on a
          375pt phone this drops to its own line rather than squeezing the
          three controls that are always there. */}
      {watching && autopilot !== null ? (
        <ActionButton
          icon={autopilot ? "flash" : "flash-outline"}
          label={autopilot ? "Autopilot on" : "Autopilot off"}
          accessibilityLabel={
            autopilot
              ? "Autopilot is on — tap to go back to confirming each rally"
              : "Autopilot is off — tap to let the camera score rallies on its own"
          }
          highlighted={autopilot}
          onPress={onToggleAutopilot}
        />
      ) : null}
    </View>
  );
}

interface ActionButtonProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  /** Defaults to the label; set it where the label alone is not a sentence. */
  accessibilityLabel?: string;
  /** Accent fill, for a control that is currently changing what the app does. */
  highlighted?: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/** Secondary courtside action: small, but still a full 44pt target. */
function ActionButton({
  icon,
  label,
  accessibilityLabel,
  highlighted = false,
  onPress,
  disabled = false,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        highlighted && styles.actionOn,
        pressed && styles.pressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Ionicons name={icon} size={18} color={highlighted ? colors.onAccent : colors.text} />
      <Text
        style={[styles.actionLabel, highlighted && styles.actionLabelOn]}
        numberOfLines={1}
      >
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
  // Wraps rather than truncates: at the largest Dynamic Type sizes three
  // pill buttons no longer fit one 375pt line, and a clipped "Stop watching"
  // is worse than a second row.
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
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
    minWidth: MIN_TOUCH_TARGET,
    flexShrink: 1,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  actionDisabled: { opacity: 0.35 },
  actionOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionLabelOn: { color: colors.onAccent },
  actionLabel: { ...type.label, color: colors.text, flexShrink: 1 },
  pressed: { opacity: 0.7 },
});
