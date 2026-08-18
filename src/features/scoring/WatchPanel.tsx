/**
 * The court, as the app sees it: a small live preview beside the few facts that
 * change what a human should do.
 *
 * The preview comes from the analyzer module, never from expo-camera. iOS hands
 * the camera to exactly one AVCaptureSession, so a second camera view on this
 * screen would fight the session that is doing the watching.
 *
 * WHY IT IS SMALL. The preview answers one question — "is the phone pointed at
 * the court with both players in it?" — and that question is asked once, while
 * setting the phone down. The score is read every rally for forty-five minutes,
 * from a metre away, by someone out of breath. So the preview gets a fixed
 * postage stamp and the scoreboard keeps the rest of the screen, including on a
 * 667pt phone with a question showing.
 *
 * Beside it go only the things that change behaviour: whether it can hear
 * anything at all, whether it is about to count the next court's play, and
 * which player it thinks is which. Frame counters and pose rates are
 * diagnostics, and diagnostics on a scoreboard are noise between someone and
 * their score.
 */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { PlayerNames } from "./announce";
import { sideForTrack, type LiveStatus, type TrackBinding } from "./liveClient";
import type { LivePreview } from "./useLiveReferee";

interface WatchPanelProps {
  Preview: LivePreview | null;
  status: LiveStatus | null;
  starting: boolean;
  names: PlayerNames;
  binding: TrackBinding;
  onSwapBinding: () => void;
  /** Shots seen in the rally in play; null between rallies. */
  rallyStrikes: number | null;
  /** Short screens get the smaller stamp, same threshold as the scoreboard. */
  compact: boolean;
}

/**
 * The one thing worth saying, or null.
 *
 * Ordered by what it costs the user to not know. A missing microphone means no
 * suggestion will EVER arrive, so it outranks everything; an uncalibrated court
 * means suggestions will arrive that belong to somebody else's match.
 */
function warningFor(status: LiveStatus | null): string | null {
  if (status === null) return null;
  if (!status.detectionAvailable) {
    return "No microphone, so it cannot hear shots. It will not suggest anything.";
  }
  if (status.problem === "interrupted") return "Something else took the camera.";
  if (!status.courtCalibrated) return "Court corners aren't set — the next court can count too.";
  if (status.thermalState === "serious" || status.thermalState === "critical") {
    return "Phone is hot — watching fewer frames, so it will miss more.";
  }
  return null;
}

export function WatchPanel({
  Preview,
  status,
  starting,
  names,
  binding,
  onSwapBinding,
  rallyStrikes,
  compact,
}: WatchPanelProps) {
  const warning = warningFor(status);
  const live = status?.state === "running";
  const stamp = compact ? styles.stampCompact : styles.stamp;

  return (
    <View style={styles.row}>
      <View style={stamp}>
        {Preview === null ? null : <Preview gravity="cover" style={styles.fill} />}
        {starting && !live ? (
          <View style={styles.fill}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
      </View>

      <View style={styles.column}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, live && styles.dotLive]} />
          <Text style={styles.statusText} numberOfLines={1}>
            {live ? "Watching the court" : starting ? "Starting the camera…" : "Not watching"}
          </Text>
          {rallyStrikes === null ? null : (
            <Text style={styles.strikes} numberOfLines={1}>
              rally · {rallyStrikes}
            </Text>
          )}
        </View>

        {warning === null ? null : (
          <View style={styles.warning}>
            <Ionicons name="alert-circle" size={13} color={colors.danger} />
            <Text style={styles.warningText} numberOfLines={2}>
              {warning}
            </Text>
          </View>
        )}

        <BindingChip names={names} binding={binding} onSwap={onSwapBinding} />
      </View>
    </View>
  );
}

/**
 * Which person the tracker is calling which player.
 *
 * The tracker names whoever was leftmost the first time it saw two people "A".
 * It has no idea who that is, and trackers swap, so this has to be one tap to
 * fix — otherwise every suggestion after a swap names the wrong player and the
 * human has no way to say so.
 */
function BindingChip({
  names,
  binding,
  onSwap,
}: {
  names: PlayerNames;
  binding: TrackBinding;
  onSwap: () => void;
}) {
  const leftPlayer = names[sideForTrack("A", binding)];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`The camera is reading the left-hand player as ${leftPlayer}. Tap to swap.`}
      onPress={() => {
        selectionHaptic();
        onSwap();
      }}
      style={({ pressed }) => [styles.bindingChip, pressed && styles.pressed]}
    >
      <Ionicons name="swap-horizontal" size={14} color={colors.textDim} />
      <Text style={styles.bindingText} numberOfLines={1}>
        Left is {leftPlayer}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  stamp: {
    width: 116,
    height: 116,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  stampCompact: {
    width: 92,
    height: 92,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  column: { flex: 1, justifyContent: "center", gap: spacing.xs },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textFaint },
  dotLive: { backgroundColor: colors.accent },
  statusText: { ...type.captionStrong, color: colors.text, flex: 1 },
  strikes: { ...type.caption, color: colors.textFaint, fontVariant: ["tabular-nums"] },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  warningText: { ...type.caption, color: colors.textDim, flex: 1 },
  bindingChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  bindingText: { ...type.captionStrong, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
