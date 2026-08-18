/**
 * The two pieces of chrome around watching: the way in, and the way it says no.
 *
 * Both exist to keep one promise — the tap-driven referee is the product, and
 * the camera is an accessory to it. So the entry row is an offer, never a mode
 * switch that takes the screen over, and every failure lands the user back on
 * the same working scoreboard with a sentence explaining why.
 *
 * The offer never oversells. `WATCH_PITCH` says the app asks and the human
 * decides, because on the measured numbers that is exactly what it does.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { WATCH_PITCH } from "./proposal";
import type { LiveNotice } from "./useLiveReferee";

interface WatchEntryProps {
  starting: boolean;
  onStart: () => void;
}

/** "Watch the court" — offered only when this binary can actually do it. */
export function WatchEntry({ starting, onStart }: WatchEntryProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Watch the court with the camera"
      accessibilityHint={WATCH_PITCH}
      accessibilityState={{ busy: starting }}
      disabled={starting}
      onPress={() => {
        selectionHaptic();
        onStart();
      }}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Ionicons name="eye" size={18} color={colors.onAccent} />
      </View>
      <View style={styles.entryText}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          Watch the court
        </Text>
        <Text style={styles.entryCaption} numberOfLines={2}>
          {WATCH_PITCH}
        </Text>
      </View>
      {starting ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      )}
    </Pressable>
  );
}

interface NoticeBannerProps {
  notice: LiveNotice;
  onDismiss: () => void;
}

/**
 * What happened when watching could not start. Deliberately a quiet banner and
 * not an Alert: the score is on screen behind it and a modal over a live match
 * is the last thing anybody courtside wants.
 */
export function NoticeBanner({ notice, onDismiss }: NoticeBannerProps) {
  return (
    <View style={styles.notice}>
      <Ionicons name="information-circle" size={16} color={colors.textDim} />
      <Text style={styles.noticeText}>{notice.text}</Text>
      {notice.canOpenSettings ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
          onPress={() => {
            selectionHaptic();
            // Guarded: openSettings can reject on exotic Android builds.
            Linking.openSettings().catch(() => {});
          }}
          style={({ pressed }) => [styles.noticeAction, pressed && styles.pressed]}
        >
          <Text style={styles.noticeActionLabel}>Settings</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss this message"
        onPress={onDismiss}
        style={({ pressed }) => [styles.noticeClose, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={16} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.cardRaised,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { ...type.bodyStrong, color: colors.text },
  entryCaption: { ...type.caption, color: colors.textDim },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  noticeText: { ...type.caption, color: colors.textDim, flex: 1, paddingVertical: spacing.sm },
  noticeAction: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center" },
  noticeActionLabel: { ...type.label, color: colors.accentText },
  noticeClose: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
