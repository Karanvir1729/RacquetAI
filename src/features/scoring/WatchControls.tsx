/**
 * How watching says no.
 *
 * It exists to keep one promise: the tap-driven referee is the product and the
 * camera is an accessory to it, so every failure lands the user back on the
 * same working scoreboard with a sentence explaining why — never on a dead end.
 *
 * The way IN lives in RefereeModes.tsx, next to the video option, because
 * "watch live" and "score a video" are one choice and belong in one place.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import type { LiveNotice } from "./useLiveReferee";

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
