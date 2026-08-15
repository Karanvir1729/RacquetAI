import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Pressable, Text, View } from "react-native";

import { formatClock } from "@/lib/format";
import { colors, radius, spacing, type } from "@/theme/tokens";

/**
 * Camera-overlay controls: the record button, the flip-camera button, and the
 * elapsed-time badge. Dumb components — the screen owns all recording state.
 */

interface RecordButtonProps {
  recording: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * The classic camera control: a fixed white ring whose red core morphs from
 * circle (idle) to rounded square (recording) — shape, not just colour,
 * carries the state.
 */
export function RecordButton({ recording, disabled = false, onPress }: RecordButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? "Stop recording" : "Start recording"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.recordOuter,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.recordCore, recording && styles.recordCoreActive]} />
    </Pressable>
  );
}

interface FlipButtonProps {
  disabled?: boolean;
  onPress: () => void;
}

/** Front/back toggle. Disabled while recording — flipping mid-take stops the camera. */
export function FlipButton({ disabled = false, onPress }: FlipButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Flip camera"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.flip, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name="camera-reverse-outline" size={24} color={colors.text} />
    </Pressable>
  );
}

/** Pulsing-dot elapsed badge shown at the top of the preview while recording. */
export function ElapsedBadge({ elapsedSec }: { elapsedSec: number }) {
  return (
    <View style={styles.badge} accessibilityLabel={`Recording, ${formatClock(elapsedSec)} elapsed`}>
      <View style={styles.badgeDot} />
      <Text style={styles.badgeText}>{formatClock(elapsedSec)}</Text>
    </View>
  );
}

const RECORD_SIZE = 76;
const CORE_SIZE = 58;
const STOP_SIZE = 28;

const styles = StyleSheet.create({
  recordOuter: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    borderWidth: 4,
    // Literal white on both themes — this floats over live video, not a surface.
    borderColor: colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
  },
  recordCore: {
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
    backgroundColor: colors.danger,
  },
  recordCoreActive: {
    width: STOP_SIZE,
    height: STOP_SIZE,
    borderRadius: radius.sm - 4,
  },
  flip: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "center",
    backgroundColor: colors.chip,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.danger,
  },
  badgeText: { ...type.bodyStrong, color: colors.text, fontVariant: ["tabular-nums"] },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  disabled: { opacity: 0.4 },
});
