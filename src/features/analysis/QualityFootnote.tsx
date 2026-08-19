import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, type } from "@/theme/tokens";

import { formatCount, formatPercent } from "./format";
import type { AnalysisQuality } from "./types";

interface QualityFootnoteProps {
  quality: AnalysisQuality;
}

/**
 * Honest small print under the numbers: how much footage the pipeline actually
 * measured, the audio caveat when rally boundaries had no sound to lean on,
 * and any notes the pipeline attached.
 */
export function QualityFootnote({ quality }: QualityFootnoteProps) {
  const lines = [
    `Based on ${formatCount(quality.framesAnalyzed)} analyzed frames · both players detected in ` +
      // bothPlayersDetectedPct is already 0..100 per the contract.
      `${formatPercent(quality.bothPlayersDetectedPct / 100)} of them.`,
  ];
  if (!quality.audioAvailable) {
    lines.push("No audio track — shot and rally boundaries are estimated from motion alone.");
  }
  return (
    <View style={styles.wrap}>
      {lines.concat(quality.notes).map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, paddingHorizontal: spacing.xs },
  line: { ...type.caption, color: colors.textDim },
});
