/**
 * New-match setup: who is playing and who serves first (the racquet spin).
 *
 * Names are optional — the fields start on "Player A" / "Player B" and Start
 * works untouched — but they are worth asking for, because "Game to Priya" is
 * a call two players can act on from the back of the court and "Game to Player
 * A" is one they have to stop and decode.
 */
import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Segmented } from "@/components/Segmented";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { DEFAULT_PLAYER_NAMES, PlayerNames } from "./announce";
import { MAX_PLAYER_NAME_LENGTH, sanitizePlayerName } from "./storage";
import { MatchSetup } from "./useRefereeMatch";
import { Side, SIDES } from "./types";

interface NewMatchSheetProps {
  visible: boolean;
  /** Seeds the fields, so "new match, same two people" is one tap. */
  initialNames: PlayerNames;
  onStart: (setup: MatchSetup) => void;
  onClose: () => void;
}

export function NewMatchSheet({ visible, initialNames, onStart, onClose }: NewMatchSheetProps) {
  const [draft, setDraft] = useState<PlayerNames>(initialNames);
  const [firstServer, setFirstServer] = useState<Side>("A");
  const insets = useSafeAreaInsets();

  const start = () => {
    onStart({
      names: {
        A: sanitizePlayerName(draft.A, DEFAULT_PLAYER_NAMES.A),
        B: sanitizePlayerName(draft.B, DEFAULT_PLAYER_NAMES.B),
      },
      firstServer,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      // Re-seed from the live names every time it opens, so a cancelled edit
      // never leaks into the next match.
      onShow={() => {
        setDraft(initialNames);
        setFirstServer("A");
      }}
    >
      <View style={styles.root}>
        {/* automaticallyAdjustKeyboardInsets, the house keyboard pattern
            (components/Screen.tsx): it scrolls the focused field into view
            instead of just shrinking the frame around it. */}
        <ScrollView
          // The sheet covers the status bar, so its top pad is the real inset —
          // a fixed one either collides with the notch or floats on a flat top.
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.column}>
            <Text style={styles.title}>New match</Text>
            <Text style={styles.caption}>
              Best of 5 games, PAR-11 — first to 11 points, win by two.
            </Text>

            {SIDES.map((side) => (
              <View key={side} style={styles.field}>
                <Text style={styles.label}>{side === "A" ? "Player A" : "Player B"}</Text>
                <TextInput
                  style={styles.input}
                  value={draft[side]}
                  onChangeText={(text) => setDraft((current) => ({ ...current, [side]: text }))}
                  placeholder={DEFAULT_PLAYER_NAMES[side]}
                  placeholderTextColor={colors.textFaint}
                  maxLength={MAX_PLAYER_NAME_LENGTH}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  accessibilityLabel={`Name for player ${side}`}
                />
              </View>
            ))}

            <View style={styles.field}>
              <Text style={styles.label}>Serves first</Text>
              <Segmented
                options={[
                  { key: "A" as const, label: sanitizePlayerName(draft.A, DEFAULT_PLAYER_NAMES.A) },
                  { key: "B" as const, label: sanitizePlayerName(draft.B, DEFAULT_PLAYER_NAMES.B) },
                ]}
                value={firstServer}
                onChange={setFirstServer}
              />
            </View>

            <Button label="Start match" onPress={start} />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                selectionHaptic();
                onClose();
              }}
              haptic="none"
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  // The gap lives on the column, not the content container, so the fields keep
  // their spacing while the column stays centred and narrow on iPad.
  column: { ...column(FORM_MAX_WIDTH), gap: spacing.md },
  title: { ...type.title, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  field: { gap: spacing.xs },
  label: { ...type.label, color: colors.textDim },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    ...type.body,
    color: colors.text,
  },
});
