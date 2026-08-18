/**
 * The question the app asks when it thinks a rally has ended.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO CONFIRM BUTTON IN THIS FILE, AND THAT IS THE POINT.
 * ---------------------------------------------------------------------------
 * The answer is given on the two rally buttons that are already on screen and
 * are there whether the camera is watching or not. When a player is suggested,
 * THEIR button lights up (RallyButtons' `suggested` prop) — so confirming is
 * one tap, correcting is one tap on the other button, and neither is a control
 * the user had to learn for this feature. It also means the manual referee is
 * never a mode you have to leave: the suggestion decorates the manual controls
 * instead of replacing them.
 *
 * What lives here is the question itself, the reason behind it, and the way
 * OUT — "No point", for the measured case where the break was not a rally end
 * at all (1 of 15 inspected breaks was mid-rally).
 *
 * Nothing here runs on a timer. An unanswered question stays unanswered.
 */
import { Ionicons } from "@expo/vector-icons";
import { ComponentProps, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { PlayerNames } from "./announce";
import type { RallyProposal, TrackBinding } from "./liveClient";
import {
  confidenceLine,
  humanizeWhy,
  proposalLevel,
  proposalQuestion,
  proposalSubtitle,
  WATCH_ACCURACY_NOTE,
} from "./proposal";

interface ProposalPromptProps {
  proposal: RallyProposal;
  names: PlayerNames;
  binding: TrackBinding;
  /** Shots landed after the question was asked — they played on. */
  playResumed: boolean;
  onDismiss: () => void;
}

export function ProposalPrompt({
  proposal,
  names,
  binding,
  playResumed,
  onDismiss,
}: ProposalPromptProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const level = proposalLevel(proposal, playResumed);
  const question = proposalQuestion(proposal, names, level);
  const subtitle = proposalSubtitle(proposal, names, level, playResumed);

  return (
    <View style={[styles.card, playResumed && styles.cardStale]}>
      <Text
        style={styles.question}
        numberOfLines={1}
        adjustsFontSizeToFit
        // Read from a metre away between rallies; capped for the same reason
        // the scoreboard numeral is, since this screen cannot scroll.
        maxFontSizeMultiplier={1.3}
      >
        {question}
      </Text>
      <Text style={styles.subtitle} numberOfLines={2}>
        {subtitle}
      </Text>

      {detailOpen ? (
        <View style={styles.detail}>
          <Text style={styles.detailText}>{humanizeWhy(proposal.why, binding, names)}</Text>
          <Text style={styles.detailText}>{confidenceLine(proposal)}</Text>
          <Text style={styles.detailNote}>{WATCH_ACCURACY_NOTE}</Text>
        </View>
      ) : null}

      <View style={styles.row}>
        <SmallButton
          icon={detailOpen ? "chevron-up" : "help-circle-outline"}
          label={detailOpen ? "Hide" : "Why?"}
          accessibilityLabel={detailOpen ? "Hide why it asked" : "Why it asked"}
          onPress={() => setDetailOpen((open) => !open)}
        />
        <SmallButton
          icon="close-circle-outline"
          label="No point"
          accessibilityLabel="No point — dismiss the question without scoring"
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

interface SmallButtonProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function SmallButton({ icon, label, accessibilityLabel, onPress }: SmallButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.small, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={16} color={colors.textDim} />
      <Text style={styles.smallLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  // Play carried on after the question. Drop the accent so it stops looking
  // like something to agree with.
  cardStale: { borderColor: colors.line2, backgroundColor: colors.card },
  question: { ...type.title, color: colors.text },
  subtitle: { ...type.caption, color: colors.textDim },
  detail: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  detailText: { ...type.caption, color: colors.textDim },
  detailNote: { ...type.caption, color: colors.textFaint },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  small: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingRight: spacing.md,
  },
  smallLabel: { ...type.label, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
