/**
 * What is on screen after a video has been refereed: where the score came
 * from, what the app had to throw away to get it, and the two corrections that
 * change every rally at once.
 *
 * The two controls are here rather than in a settings sheet because they are
 * the two ways a whole scoreline is wrong in a way the numbers cannot show.
 * Swapping the players mirrors it exactly; the wrong first server shifts every
 * hand-out after the first rally. Both re-run the fold from the top.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { PlayerNames } from "./announce";
import { Side } from "./types";
import { scorelineNote, VideoRefereeResult } from "./videoReferee";

interface VideoResultBandProps {
  result: VideoRefereeResult;
  names: PlayerNames;
  firstServer: Side;
  onSwapPlayers: () => void;
  onSetFirstServer: (side: Side) => void;
  onClear: () => void;
  /**
   * True when a player is mounted above this band. The corrections are still
   * the point; the long note is not, because the video above is already
   * showing rally-by-rally what it has called.
   */
  compact?: boolean;
}

export function VideoResultBand({
  result,
  names,
  firstServer,
  onSwapPlayers,
  onSetFirstServer,
  onClear,
  compact = false,
}: VideoResultBandProps) {
  const scored = result.rallies.length - result.ignoredAfterMatch;
  // Both of these are evidence the rally rule is wrong for this footage, so
  // they are stated rather than quietly folded away.
  const leftovers: string[] = [];
  if (result.discarded > 0) {
    leftovers.push(`${result.discarded} stray ${result.discarded === 1 ? "sound" : "sounds"} skipped`);
  }
  if (result.ignoredAfterMatch > 0) {
    leftovers.push(`${result.ignoredAfterMatch} after match point ignored`);
  }

  if (compact) {
    // Under a player: the corrections and nothing else. The heading, the note
    // and the leftovers are all either drawn or spoken by the player above,
    // and this screen has no room to say anything twice.
    return (
      <View style={styles.actions}>
        <Action
          icon="swap-horizontal"
          label="Swap players"
          accessibilityLabel="Swap which player the video calls A — mirrors the whole scoreline"
          onPress={onSwapPlayers}
        />
        <Action
          icon="tennisball-outline"
          label={`${names[firstServer]} served first`}
          accessibilityLabel={`${names[firstServer]} served first — tap to switch`}
          onPress={() => onSetFirstServer(firstServer === "A" ? "B" : "A")}
        />
        <Action
          icon="close"
          label="Done"
          accessibilityLabel="Done with this video result — back to the referee options"
          onPress={onClear}
        />
      </View>
    );
  }

  return (
    <View style={styles.band}>
      <View style={styles.head}>
        <Ionicons name="film" size={15} color={colors.accent} />
        <Text style={styles.title} numberOfLines={1}>
          Scored from video
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done with this video result — back to the referee options"
          onPress={() => {
            selectionHaptic();
            onClear();
          }}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={16} color={colors.textDim} />
        </Pressable>
      </View>

      {compact ? null : (
        <Text style={styles.note} numberOfLines={2}>
          {scorelineNote(scored)}
        </Text>
      )}
      {leftovers.length > 0 ? (
        <Text style={styles.leftovers} numberOfLines={1}>
          {leftovers.join(" · ")}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Action
          icon="swap-horizontal"
          label="Swap players"
          accessibilityLabel="Swap which player the video calls A — mirrors the whole scoreline"
          onPress={onSwapPlayers}
        />
        <Action
          icon="tennisball-outline"
          label={`${names[firstServer]} served first`}
          accessibilityLabel={`${names[firstServer]} served first — tap to switch`}
          onPress={() => onSetFirstServer(firstServer === "A" ? "B" : "A")}
        />
      </View>
    </View>
  );
}

interface ActionProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function Action({ icon, label, accessibilityLabel, onPress }: ActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={15} color={colors.accentText} />
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  band: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  title: { ...type.label, color: colors.text, flex: 1 },
  clear: {
    width: MIN_TOUCH_TARGET / 1.5,
    height: MIN_TOUCH_TARGET / 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { ...type.caption, color: colors.textDim },
  leftovers: { ...type.caption, color: colors.textFaint },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET * 0.8,
    paddingRight: spacing.sm,
  },
  actionLabel: { ...type.caption, color: colors.accentText },
  pressed: { opacity: 0.7 },
});
