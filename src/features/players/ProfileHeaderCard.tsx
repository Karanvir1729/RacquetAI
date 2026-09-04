import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Segmented } from "@/components/Segmented";
import { notifyWarning, selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import type { ProfileStats } from "./aggregate";
import { formatIsoDay, HAND_LABELS, recordingsWord } from "./display";
import { PLAYER_NOTES_MAX, validateNotes, validatePlayerName, type Hand, type Player } from "./shape";

/** Segmented keys: the two hands plus "not known" (null in the row). */
type HandKey = "unknown" | Hand;
const HAND_OPTIONS = [
  { key: "unknown", label: "Not known" },
  { key: "right", label: "Right" },
  { key: "left", label: "Left" },
] as const;

interface ProfileHeaderCardProps {
  player: Player;
  stats: ProfileStats;
  /** Each returns an error message, or null when it landed — the store's convention. */
  onRename: (name: string) => Promise<string | null>;
  onHand: (hand: Hand | null) => Promise<string | null>;
  onNotes: (notes: string) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}

/**
 * The top of a profile: name, the chips that size the evidence (hand,
 * recordings, minutes, since), the owner's notes, and the edits — an inline
 * form for name / hand / notes, and delete behind the app's usual Alert
 * confirm. Edits go through callbacks so the screen re-reads after each one
 * rather than patching state by hand: what is on screen is what the row holds.
 */
export function ProfileHeaderCard({
  player,
  stats,
  onRename,
  onHand,
  onNotes,
  onDelete,
}: ProfileHeaderCardProps) {
  const [editing, setEditing] = useState(false);
  // Seeded once per mount: the screen keys this card on the row's values, so a
  // save that lands remounts it and a second edit starts from what is now
  // true rather than from the last thing typed.
  const [draft, setDraft] = useState({ name: player.name, hand: player.hand, notes: player.notes });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameError = editing ? validatePlayerName(draft.name) : null;
  const notesError = editing ? validateNotes(draft.notes) : null;

  const save = async () => {
    if (nameError !== null || notesError !== null) return;
    setBusy(true);
    setFailure(null);
    // Three separate writes because the store exposes three; they stop at the
    // first failure so a rejected name never leaves a half-applied edit.
    let message: string | null = null;
    const name = draft.name.trim();
    const notesText = draft.notes.trim();
    if (name !== player.name) message = await onRename(name);
    if (message === null && draft.hand !== player.hand) message = await onHand(draft.hand);
    if (message === null && notesText !== player.notes) message = await onNotes(notesText);
    setBusy(false);
    if (message === null) setEditing(false);
    else setFailure(message);
  };

  const confirmDelete = () => {
    notifyWarning();
    Alert.alert(
      `Delete ${player.name}?`,
      `Their ${recordingsWord(stats.recordings)} come off this roster with them. The analyses ` +
        "themselves stay in your library — only the name on them goes. This cannot be undone.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            setFailure(null);
            void onDelete().then((message) => {
              setBusy(false);
              if (message !== null) setFailure(message);
            });
          },
        },
      ],
    );
  };

  const minutes = Math.round(stats.totalSec / 60);
  const chips: string[] = [];
  if (player.hand !== null) chips.push(HAND_LABELS[player.hand]);
  chips.push(recordingsWord(stats.recordings));
  if (stats.recordings > 0) chips.push(`${minutes} min analysed`);
  if (stats.firstPlayedAt !== null) chips.push(`since ${formatIsoDay(stats.firstPlayedAt)}`);

  return (
    <Card>
      <View style={styles.titleRow}>
        {/* The pinned ScreenHeader already carries the name and the
            recordings line; repeating them here 120pt lower read as an echo.
            The card keeps what the header does not show — the chips. */}
        <View style={styles.titleBlock} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? "Cancel editing" : "Edit name, hand and notes"}
          accessibilityState={{ disabled: busy, expanded: editing }}
          disabled={busy}
          onPress={() => {
            selectionHaptic();
            setEditing((value) => !value);
            setFailure(null);
          }}
          hitSlop={spacing.xs}
          style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
        >
          <Text style={styles.editLabel}>{editing ? "Cancel" : "Edit"}</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip} style={styles.chip}>
            <Text style={styles.chipLabel}>{chip}</Text>
          </View>
        ))}
      </View>

      {player.notes.length > 0 && !editing ? <Text style={styles.notes}>{player.notes}</Text> : null}

      {editing ? (
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
              maxLength={80}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!busy}
              accessibilityLabel="Player name"
            />
            {nameError !== null ? <Text style={styles.error}>{nameError}</Text> : null}
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Racquet hand</Text>
            <Segmented<HandKey>
              options={HAND_OPTIONS}
              value={draft.hand ?? "unknown"}
              onChange={(key) => setDraft((d) => ({ ...d, hand: key === "unknown" ? null : key }))}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={draft.notes}
              onChangeText={(notes) => setDraft((d) => ({ ...d, notes }))}
              maxLength={PLAYER_NOTES_MAX}
              multiline
              textAlignVertical="top"
              placeholder="Anything the numbers cannot tell you — how they serve, what they do under pressure."
              placeholderTextColor={colors.textFaint}
              editable={!busy}
              accessibilityLabel="Notes about this player"
            />
            {notesError !== null ? <Text style={styles.error}>{notesError}</Text> : null}
          </View>
          {failure !== null ? (
            <Text style={styles.error} accessibilityRole="alert">
              {failure}
            </Text>
          ) : null}
          <Button
            label={busy ? "Saving…" : "Save"}
            onPress={() => void save()}
            loading={busy}
            disabled={busy || nameError !== null || notesError !== null}
          />
          <Button
            label="Delete player"
            variant="danger"
            onPress={confirmDelete}
            disabled={busy}
            haptic="none"
          />
        </View>
      ) : failure !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {failure}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  titleBlock: { flex: 1, gap: 2 },
  eyebrow: { ...type.captionStrong, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.6 },
  name: { ...type.title, color: colors.text },
  editButton: {
    minHeight: MIN_TOUCH_TARGET - spacing.sm,
    paddingHorizontal: spacing.sm + spacing.xs,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  editLabel: { ...type.captionStrong, color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipLabel: { ...type.captionStrong, color: colors.textDim },
  notes: { ...type.body, color: colors.text },
  form: { gap: spacing.md, paddingTop: spacing.xs },
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
  notesInput: { minHeight: 88, paddingVertical: spacing.sm },
  error: { ...type.caption, color: colors.danger },
  pressed: { opacity: 0.7 },
});
