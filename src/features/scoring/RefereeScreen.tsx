/**
 * Score keeper — the courtside scoreboard. You tap who won the rally, it keeps
 * a proper PAR-11 squash score and calls it out loud in marker's convention,
 * so two players never have to stop and argue about where they are.
 *
 * It is a HUMAN-TAPPED scoreboard with a voice. Nothing on this screen watches
 * the court, and no copy on it may suggest otherwise.
 *
 * Layout is fixed (no scroll): board in the middle, the two rally buttons
 * pinned to the bottom where a thumb lands, and everything secondary — undo,
 * appeals, a new match — in one small row between them. Undo is always one tap
 * and never moves.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ComponentProps, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { AppealSheet } from "./AppealSheet";
import { NewMatchSheet } from "./NewMatchSheet";
import { RallyButtons } from "./RallyButtons";
import { ScoreBoard } from "./ScoreBoard";
import { MatchSetup, useRefereeMatch } from "./useRefereeMatch";
import { LetRuling, OTHER_SIDE, Side } from "./types";

export function RefereeScreen() {
  const match = useRefereeMatch();
  const [appealOpen, setAppealOpen] = useState(false);
  // The receiver appeals far more often than the server, so that is the
  // default the sheet opens on.
  const [appealer, setAppealer] = useState<Side>(OTHER_SIDE[match.score.server]);
  const [setupOpen, setSetupOpen] = useState(false);
  const matchOver = match.score.winner !== null;

  const goBack = () => {
    selectionHaptic();
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  const openAppeal = () => {
    selectionHaptic();
    setAppealer(OTHER_SIDE[match.score.server]);
    setAppealOpen(true);
  };

  const rule = (ruling: LetRuling) => {
    setAppealOpen(false);
    match.ruleAppeal(appealer, ruling);
  };

  const openSetup = () => {
    selectionHaptic();
    // Only guard a match that is actually underway — a finished or untouched
    // one has nothing left to lose.
    if (!match.canUndo || matchOver) {
      setSetupOpen(true);
      return;
    }
    Alert.alert("Start a new match?", "The current match and its score will be discarded.", [
      { text: "Keep scoring", style: "cancel" },
      { text: "New match", style: "destructive", onPress: () => setSetupOpen(true) },
    ]);
  };

  const start = (setup: MatchSetup) => {
    setSetupOpen(false);
    match.startMatch(setup);
  };

  return (
    <Screen>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Library"
          onPress={goBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.backLabel}>Library</Text>
        </Pressable>
        {/* Hidden outright when the speech module is missing: a toggle that
            cannot change anything is worse than no toggle. */}
        {match.speechAvailable ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: !match.muted }}
            accessibilityLabel={
              match.muted ? "Turn score announcements on" : "Mute score announcements"
            }
            onPress={() => {
              selectionHaptic();
              match.toggleMute();
            }}
            style={({ pressed }) => [styles.mute, pressed && styles.pressed]}
          >
            <Ionicons
              name={match.muted ? "volume-mute" : "volume-high"}
              size={20}
              color={match.muted ? colors.textFaint : colors.accentText}
            />
          </Pressable>
        ) : null}
      </View>

      <ScreenHeader
        title="Score keeper"
        subtitle="You tap who won the rally — it keeps score and calls it out"
      />

      <View style={styles.board}>
        <ScoreBoard score={match.score} names={match.names} onChooseBox={match.chooseBox} />
      </View>

      <View style={styles.callRow}>
        <Text style={styles.call} numberOfLines={2}>
          {match.lastCall ?? "Tap a player when they win a rally."}
        </Text>
        {match.speechAvailable && match.muted ? <Text style={styles.callMeta}>Muted</Text> : null}
      </View>

      <View style={styles.callArea}>
        {matchOver ? (
          <Button label="New match" onPress={openSetup} />
        ) : (
          <RallyButtons names={match.names} server={match.score.server} onWin={match.awardRally} />
        )}
      </View>

      <View style={styles.actions}>
        <ActionButton
          icon="arrow-undo"
          label="Undo"
          onPress={match.undo}
          disabled={!match.canUndo}
        />
        <ActionButton icon="hand-left" label="Let…" onPress={openAppeal} disabled={matchOver} />
        {matchOver ? null : <ActionButton icon="refresh" label="New match" onPress={openSetup} />}
      </View>

      <AppealSheet
        visible={appealOpen}
        names={match.names}
        appealer={appealer}
        onChangeAppealer={setAppealer}
        onRule={rule}
        onClose={() => setAppealOpen(false)}
      />
      <NewMatchSheet
        visible={setupOpen}
        initialNames={match.names}
        onStart={start}
        onClose={() => setSetupOpen(false)}
      />
    </Screen>
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
  board: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.md },
  callRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  call: { ...type.captionStrong, color: colors.textDim, flex: 1 },
  callMeta: { ...type.caption, color: colors.textFaint },
  callArea: { paddingHorizontal: spacing.md },
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
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  actionDisabled: { opacity: 0.35 },
  actionLabel: { ...type.label, color: colors.text },
  pressed: { opacity: 0.7 },
});
