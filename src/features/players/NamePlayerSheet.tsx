import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { recordingsWord } from "./display";
import { isIsoDay, PLAYER_NAME_MAX, validatePlayerName } from "./shape";
import type { ClipTag, RosterEntry } from "./store";

/** Who to tag: someone already on the roster, or a name typed fresh. */
export type NameChoice = { playerId: string } | { name: string };

interface NamePlayerSheetProps {
  visible: boolean;
  /** The analysis' own label for this side — "Player A (lighter shirt)". */
  label: string;
  /** Null while loading. */
  roster: RosterEntry[] | null;
  /** Whoever this side is tagged as now, so the list can say so. */
  current: ClipTag | null;
  defaultPlayedAt: string;
  busy: boolean;
  error: string | null;
  onSave: (choice: NameChoice, playedAt: string) => void;
  onClose: () => void;
}

/**
 * The "who is Player A?" sheet: the roster to tap, a name to type, and the day
 * it was played. A modal rather than a popover because a phone has no room
 * under a header for a list, and a sheet is what iOS users expect a short
 * form to be.
 *
 * The name field doubles as a search over the roster: a long roster is
 * unusable as a plain list, and typing the person's name is what you would do
 * anyway. An exact match on Save reuses the existing player (the store treats
 * a duplicate name as "already have"), so typing instead of tapping cannot
 * fork a profile.
 *
 * "Played on" is a plain YYYY-MM-DD field: the app carries no native date
 * picker dependency today, and adding one for a field that is prefilled with
 * the right answer nearly every time is not worth a native module.
 */
export function NamePlayerSheet({
  visible,
  label,
  roster,
  current,
  defaultPlayedAt,
  busy,
  error,
  onSave,
  onClose,
}: NamePlayerSheetProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [playedAt, setPlayedAt] = useState(isIsoDay(defaultPlayedAt) ? defaultPlayedAt : "");
  const [attempted, setAttempted] = useState(false);

  const nameProblem = validatePlayerName(name);
  const dateProblem = isIsoDay(playedAt) ? null : "Enter the day this was played as YYYY-MM-DD.";
  const showNameError = attempted || name.length > 0;

  const needle = name.trim().toLowerCase();
  const matches = useMemo(
    () =>
      roster === null
        ? null
        : needle.length === 0
          ? roster
          : roster.filter((player) => player.name.toLowerCase().includes(needle)),
    [roster, needle],
  );

  const pick = (playerId: string) => {
    setAttempted(true);
    if (dateProblem !== null) return;
    selectionHaptic();
    onSave({ playerId }, playedAt);
  };

  const submit = () => {
    setAttempted(true);
    if (nameProblem !== null || dateProblem !== null) return;
    onSave({ name }, playedAt);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel naming this player"
            onPress={onClose}
            disabled={busy}
            style={({ pressed }) => [styles.topAction, pressed && styles.pressed]}
          >
            <Text style={styles.topActionLabel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            Who is {label.replace(/\s*\([^)]*\)\s*$/, "")}?
          </Text>
          {/* Mirrors the cancel button so the title stays centred. */}
          <View style={styles.topAction} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.column}>
            <Text style={styles.sectionLabel}>Your players</Text>
            {matches === null ? (
              <Text style={styles.caption}>Loading your players…</Text>
            ) : matches.length === 0 ? (
              <Text style={styles.caption}>
                {roster !== null && roster.length === 0
                  ? "No one on your roster yet — add the first name below."
                  : "No one on your roster matches — Save adds them."}
              </Text>
            ) : (
              <View style={styles.list}>
                {matches.map((player) => {
                  const isCurrent = current !== null && current.playerId === player.id;
                  return (
                    <Pressable
                      key={player.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Name ${label} as ${player.name}${isCurrent ? ", current" : ""}`}
                      accessibilityState={{ disabled: busy, selected: isCurrent }}
                      disabled={busy}
                      onPress={() => pick(player.id)}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    >
                      <Text style={styles.rowName} numberOfLines={1}>
                        {player.name}
                        {isCurrent ? <Text style={styles.rowCurrent}>  current</Text> : null}
                      </Text>
                      <Text style={styles.rowMeta}>{recordingsWord(player.recordings)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={styles.orRow}>
              <View style={styles.hairline} />
              <Text style={styles.caption}>or</Text>
              <View style={styles.hairline} />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>New player</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                maxLength={PLAYER_NAME_MAX}
                placeholder="Their name, as you'd say it"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                editable={!busy}
                accessibilityLabel="New player name"
              />
              {showNameError && nameProblem !== null ? (
                <Text style={styles.error}>{nameProblem}</Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Played on</Text>
              <TextInput
                style={styles.input}
                value={playedAt}
                onChangeText={setPlayedAt}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textFaint}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                maxLength={10}
                editable={!busy}
                accessibilityLabel="Played on, as year-month-day"
              />
              {attempted && dateProblem !== null ? (
                <Text style={styles.error}>{dateProblem}</Text>
              ) : null}
            </View>

            {error !== null ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <Button
              label={busy ? "Saving…" : "Save"}
              onPress={submit}
              loading={busy}
              disabled={busy}
            />
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  topAction: {
    minWidth: 72,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  topActionLabel: { ...type.label, color: colors.accentText },
  title: { ...type.bodyStrong, color: colors.text, flex: 1, textAlign: "center" },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  column: { ...column(FORM_MAX_WIDTH), gap: spacing.md },
  sectionLabel: { ...type.label, color: colors.textDim },
  caption: { ...type.caption, color: colors.textDim },
  list: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowName: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  rowCurrent: { ...type.captionStrong, color: colors.accentText },
  rowMeta: { ...type.caption, color: colors.textDim },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hairline: { flex: 1, height: 1, backgroundColor: colors.line },
  field: { gap: spacing.xs },
  fieldLabel: { ...type.label, color: colors.textDim },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.cardRaised,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...type.body,
  },
  error: { ...type.caption, color: colors.danger },
  pressed: { opacity: 0.7 },
});
