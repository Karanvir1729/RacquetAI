/**
 * The way into refereeing: two options and one switch.
 *
 *   Watch live   — the camera watches the court now.
 *   Score a video — an analysis already on the phone, refereed end to end.
 *
 * They are the same engine on two clocks. Live, the rally end arrives ~6 s
 * after the last strike and there is a human standing there, so it asks. On a
 * video there is no human in the loop at all, so it scores the lot and hands
 * over a draft to correct.
 *
 * The AUTOPILOT switch is the one control on this screen that changes what the
 * app is allowed to do, so it says so in plain words wherever it appears. Off,
 * the camera asks and a tap decides. On, it commits its own answer after a
 * visible countdown — at a measured 72.7% ceiling, which is a wrong point
 * roughly every four rallies, so the copy never calls it accurate and the
 * countdown is always long enough to catch.
 */
import { Ionicons } from "@expo/vector-icons";
import { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { AUTOPILOT_OFF_NOTE, AUTOPILOT_ON_NOTE, AUTOPILOT_PITCH } from "./autopilot";
import { WATCH_PITCH } from "./proposal";

interface ModeChooserProps {
  /** False in a binary without the native session — the live option is hidden. */
  liveAvailable: boolean;
  /**
   * Armed autopilot changes what "Watch live" DOES, so it changes what the row
   * says it does. `WATCH_PITCH` promises the human decides every point, and
   * that promise stops being true the moment the switch goes on.
   */
  autopilot: boolean;
  starting: boolean;
  onWatchLive: () => void;
  onScoreVideo: () => void;
}

/**
 * Both doors, offered together. The live one disappears entirely on a binary
 * that cannot watch (no native half, no preview view) — a button that opens a
 * broken camera is worse than no button — and the video one never does, because
 * scoring a saved analysis needs no camera at all and works on a Simulator.
 */
export function ModeChooser({
  liveAvailable,
  autopilot,
  starting,
  onWatchLive,
  onScoreVideo,
}: ModeChooserProps) {
  return (
    <View style={styles.modes}>
      {liveAvailable ? (
        <ModeRow
          icon="eye"
          title="Watch live"
          caption={autopilot ? AUTOPILOT_PITCH : WATCH_PITCH}
          accessibilityLabel="Watch the court with the camera"
          busy={starting}
          onPress={onWatchLive}
        />
      ) : null}
      <ModeRow
        icon="film"
        title="Score a video"
        caption="Referee an analysed match from the Library, rally by rally."
        accessibilityLabel="Score a video that has already been analysed"
        busy={false}
        onPress={onScoreVideo}
      />
    </View>
  );
}

interface ModeRowProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  caption: string;
  accessibilityLabel: string;
  busy: boolean;
  onPress: () => void;
}

function ModeRow({ icon, title, caption, accessibilityLabel, busy, onPress }: ModeRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={caption}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Ionicons name={icon} size={18} color={colors.onAccent} />
      </View>
      <View style={styles.entryText}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.entryCaption} numberOfLines={2}>
          {caption}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      )}
    </Pressable>
  );
}

interface AutopilotToggleProps {
  autopilot: boolean;
  onToggle: () => void;
}

/**
 * The switch that hands the pen over. The caption changes with the state
 * rather than describing the feature in the abstract, because "autopilot" on
 * its own tells a user nothing about what will happen to their score.
 */
export function AutopilotToggle({ autopilot, onToggle }: AutopilotToggleProps) {
  return (
    <View style={styles.autopilot}>
      <View style={styles.autopilotText}>
        <View style={styles.autopilotTitleRow}>
          <Ionicons
            name={autopilot ? "flash" : "flash-outline"}
            size={15}
            color={autopilot ? colors.accent : colors.textDim}
          />
          <Text style={styles.autopilotTitle}>Autopilot</Text>
        </View>
        <Text style={styles.autopilotCaption}>
          {autopilot ? AUTOPILOT_ON_NOTE : AUTOPILOT_OFF_NOTE}
        </Text>
      </View>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel="Autopilot — let the camera score rallies on its own"
        accessibilityState={{ checked: autopilot }}
        value={autopilot}
        onValueChange={() => {
          selectionHaptic();
          onToggle();
        }}
        trackColor={{ true: colors.accent, false: colors.line2 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  modes: { gap: spacing.xs },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { ...type.label, color: colors.text },
  entryCaption: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
  autopilot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  autopilotText: { flex: 1, gap: 2 },
  autopilotTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  autopilotTitle: { ...type.label, color: colors.text },
  autopilotCaption: { ...type.caption, color: colors.textDim },
});
