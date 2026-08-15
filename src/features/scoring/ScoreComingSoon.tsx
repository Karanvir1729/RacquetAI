import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { colors, radius, spacing, type } from "@/theme/tokens";

/**
 * The honest pre-AI Score tab. Nothing here pretends to work: the copy says
 * scoring is in development, the walkthrough explains what will happen, and
 * the CTA is visibly disabled. The real pipeline is specced in
 * docs/03-ai-scoring-plan.md; its on-device contract (ScoreEvent → state
 * machine) already exists in ./types.ts and ./tennis.ts.
 */
export function ScoreComingSoon() {
  return (
    <Screen scroll>
      <ScreenHeader title="Score AI" subtitle="Automatic score tracking — in development" />

      <View style={styles.hero}>
        <Ionicons name="tennisball-outline" size={56} color={colors.accent} style={styles.mark} />
        <Text style={styles.heroTitle}>AI score tracking is coming</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>In development</Text>
        </View>
        <Text style={styles.heroNote}>
          Soon RacquetAI will watch your match videos and keep score for you — tennis first,
          pickleball and badminton after. Nothing to set up now: every match you record is ready
          for scoring the day it ships.
        </Text>
      </View>

      <Card>
        <Text style={styles.cardTitle}>How it will work</Text>
        <Step
          n={1}
          icon="videocam-outline"
          title="Record a match"
          caption="Film from the Record tab — a phone on a tripod behind the baseline is enough."
        />
        <Step
          n={2}
          icon="eye-outline"
          title="AI watches the video"
          caption="It finds the court, follows the players and the ball, and works out who won each point."
        />
        <Step
          n={3}
          icon="analytics-outline"
          title="Point-by-point timeline"
          caption="Get the full score, jump the video to any point, and fix anything the AI got wrong."
        />
      </Card>

      <Card>
        <EmptyState
          title="No scored matches yet"
          caption="Once scoring ships, matches you analyze will appear here with their timelines."
          icon="podium-outline"
        />
        <Button label="Analyze a match" onPress={noop} disabled />
        <Text style={styles.ctaNote}>Not available yet — this button unlocks with the AI update.</Text>
      </Card>
    </Screen>
  );
}

function noop() {
  // Disabled teaser CTA: Button requires an onPress, but this one can never fire.
}

interface StepProps {
  n: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
}

/** One numbered walkthrough row: badge number, glyph, title + supporting copy. */
function Step({ n, icon, title, caption }: StepProps) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <View style={styles.stepBody}>
        <View style={styles.stepTitleRow}>
          <Ionicons name={icon} size={18} color={colors.accentText} />
          <Text style={styles.stepTitle}>{title}</Text>
        </View>
        <Text style={styles.stepCaption}>{caption}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  mark: { opacity: 0.9, marginBottom: spacing.xs },
  heroTitle: { ...type.title, color: colors.text, textAlign: "center" },
  badge: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.glow,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: { ...type.captionStrong, color: colors.accentText },
  heroNote: { ...type.body, color: colors.textDim, textAlign: "center", maxWidth: 320 },
  cardTitle: { ...type.heading, color: colors.text },
  step: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.glow,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepBadgeText: { ...type.captionStrong, color: colors.accentText },
  stepBody: { flex: 1, gap: 2 },
  stepTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  stepTitle: { ...type.bodyStrong, color: colors.text },
  stepCaption: { ...type.caption, color: colors.textDim },
  ctaNote: { ...type.caption, color: colors.textFaint, textAlign: "center" },
});
