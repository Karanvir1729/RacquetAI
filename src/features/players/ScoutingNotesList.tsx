import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, radius, spacing, type } from "@/theme/tokens";

import { MIN_SHOTS_FOR_NOTES, type ScoutingNote } from "./aggregate";
import { basisLabel, recordingsWord } from "./display";

interface ScoutingNotesListProps {
  notes: readonly ScoutingNote[];
  totalShots: number;
  recordings: number;
}

/**
 * The scouting notes — the sentences a coach would write on the back of a
 * hand before a match. Each is rule-based over the pooled numbers
 * (aggregate.ts holds the rules) and each carries its basis on its sleeve:
 * player POSITION and timing (coverage, the T, where the ball was retrieved),
 * which the pipeline measures, or shot CLASSES, which it reads from body pose
 * alone and has never audited. The caption is not decoration; it is the
 * difference between "they were rarely at the T" (measured) and "they go
 * cross-court a lot" (a reading), and a note that hid it would be claiming
 * more than the footage supports.
 *
 * Silence is a valid output. Under the minimum sample the rules say nothing,
 * and this says why rather than showing an empty box.
 */
export function ScoutingNotesList({ notes, totalShots, recordings }: ScoutingNotesListProps) {
  if (notes.length === 0) {
    const count = `${totalShots} ${totalShots === 1 ? "shot" : "shots"} across ${recordingsWord(recordings)}`;
    const thin = totalShots < MIN_SHOTS_FOR_NOTES;
    return (
      <Card>
        <Text style={styles.title}>{thin ? "Not enough footage yet" : "Nothing stands out yet"}</Text>
        <Text style={styles.detail}>
          {thin
            ? `${count}. Notes appear at ${MIN_SHOTS_FOR_NOTES}.`
            : `${count}, and no tendency clears the thresholds. That is a finding too — cover the middle.`}
        </Text>
      </Card>
    );
  }

  return (
    <View style={styles.list}>
      {notes.map((note) => (
        <Card key={note.id}>
          <Text style={styles.title}>{note.title}</Text>
          <Text style={styles.detail}>{note.detail}</Text>
          <View style={styles.chipRow}>
            <View style={[styles.chip, note.basis === "classes" && styles.chipIndicative]}>
              <Text style={styles.chipLabel}>{basisLabel(note.basis)}</Text>
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  title: { ...type.heading, color: colors.text },
  detail: { ...type.body, color: colors.textDim },
  chipRow: { flexDirection: "row" },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  // An indicative note does not carry the same mark as a measured one.
  chipIndicative: { backgroundColor: colors.cardRaised, borderWidth: 1, borderColor: colors.line },
  chipLabel: { ...type.captionStrong, color: colors.textDim },
});
