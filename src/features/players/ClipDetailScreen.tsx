import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuthReady, useAuthSession } from "@/lib/auth";
import { formatClock } from "@/lib/format";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

// Cross-feature imports, documented (docs/01 rule 2): the stored analysis is
// drawn with the read-out's own sections, so a clip opened from a profile
// looks exactly like the read-out it was tagged on — the same tiles, the same
// player cards, the same small print.
import { PlayerSection } from "../analysis/PlayerSection";
import { QualityFootnote } from "../analysis/QualityFootnote";
import { RallyStatsRow } from "../analysis/RallyStatsRow";
import type { MatchAnalysis } from "../analysis/types";
import { formatIsoDay } from "./display";
import { ClipPoster } from "./RecordingsList";
import type { Player, PlayerClip } from "./shape";
import { fetchClipAnalysis, getPlayer, listClips } from "./store";

interface ClipDetailScreenProps {
  /** The clip (player_clips row) to show. */
  id: string;
  /** Whose profile it was opened from — the clip is found in their list. */
  playerId: string;
}

type Loaded = { player: Player; clip: PlayerClip };

/**
 * One recording's full read-out, from the analysis stored against its tag —
 * the fallback "Show detailed analysis" opens when the clip's own analysis is
 * not on this phone. What is here is what travelled with the tag: the
 * analysis minus the pose track, and one still from the footage when one was
 * kept. The footage itself never did travel, so the still stands where the
 * video would be and the caption says so rather than letting a frozen frame
 * pass for a paused player.
 *
 * Reads like the profile screen: the player and their clips together, on
 * every focus (a re-date or a removal made moments ago is already reflected
 * when the user comes back), and the stored analysis fetched once the clip is
 * known. An analysis that will not fetch or parse is a readable "not
 * available" state — the numbers the tag kept are still on the profile.
 */
export function ClipDetailScreen({ id, playerId }: ClipDetailScreenProps) {
  const ready = useAuthReady();
  const session = useAuthSession();
  const signedIn = session !== null;

  const [status, setStatus] = useState<"loading" | "missing" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // undefined = not fetched yet; null = fetched and unusable.
  const [analysis, setAnalysis] = useState<MatchAnalysis | null | undefined>(undefined);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [player, clips] = await Promise.all([getPlayer(playerId), listClips(playerId)]);
      const clip = clips.find((item) => item.id === id);
      if (player === null || clip === undefined) {
        setStatus("missing");
        return;
      }
      setLoaded({ player, clip });
      setStatus("ready");
      if (clip.analysisPath === null) {
        setAnalysis(null);
        return;
      }
      setAnalysis(await fetchClipAnalysis(clip.analysisPath));
    } catch {
      // Network gone: keep whatever is on screen, or say "missing" if nothing is.
      setStatus((current) => (current === "ready" ? current : "missing"));
    }
  }, [id, playerId]);

  useFocusEffect(
    useCallback(() => {
      if (ready && signedIn) void load();
    }, [ready, signedIn, load]),
  );

  const backLabel = loaded === null ? "Player" : loaded.player.name;
  const goBack = () => {
    selectionHaptic();
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/player/[id]", params: { id: playerId } });
  };

  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${backLabel}`}
      onPress={goBack}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={18} color={colors.accentText} />
      <Text style={styles.backLabel} numberOfLines={1}>
        {backLabel}
      </Text>
    </Pressable>
  );

  if (!ready || (signedIn && status === "loading")) {
    return (
      <Screen>
        {back}
        <ScreenHeader title="Recording" subtitle="Loading…" />
        <LoadingState fill caption="Loading the recording…" />
      </Screen>
    );
  }

  if (!signedIn) {
    return (
      <Screen>
        {back}
        <ScreenHeader title="Recording" subtitle="Sign in to see it" />
        <View style={styles.centerFill}>
          <Card>
            <Text style={styles.cardTitle}>Sign in to see this recording</Text>
            <Text style={styles.cardBody}>
              Profiles and the recordings on them are stored against your account and private to
              you.
            </Text>
            <Button
              label="Sign in"
              onPress={() => {
                selectionHaptic();
                router.push("/account");
              }}
            />
          </Card>
        </View>
      </Screen>
    );
  }

  if (status === "missing" || loaded === null) {
    return (
      <Screen>
        {back}
        <ScreenHeader title="Recording" subtitle="Not on this profile" />
        <View style={styles.centerFill}>
          <EmptyState
            icon="film-outline"
            title="No such recording"
            caption={
              "This recording is not on the profile it was opened from — the name may have " +
              "been taken off it, or it belongs to another account."
            }
          />
        </View>
      </Screen>
    );
  }

  const { player, clip } = loaded;
  const { me } = clip.summary;
  const title = clip.title.length > 0 ? clip.title : "Recording";
  const hasStill = clip.posterPath !== null;
  const subtitle =
    `${formatIsoDay(clip.playedAt)} · as ${me.label} · ` +
    `${formatClock(clip.durationSec)} of footage`;

  return (
    <Screen>
      {back}
      <ScreenHeader title={title} subtitle={subtitle} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.posterWrap}>
          <Text style={styles.label}>{hasStill ? "A still from the footage" : "Court plan"}</Text>
          <ClipPoster clip={clip} />
          <Text style={styles.caption}>
            {hasStill
              ? "A still from the footage — the video itself stayed on the machine that analysed it."
              : "No still was kept for this recording, so its court plan stands in. " +
                "The video stayed on the machine that analysed it."}
          </Text>
        </View>

        {analysis === undefined ? (
          <LoadingState caption="Fetching the stored analysis…" />
        ) : analysis === null ? (
          <EmptyState
            icon="analytics-outline"
            iconColor={colors.danger}
            title="Analysis not available"
            caption={
              "The analysis stored with this tag could not be fetched or read. " +
              "The numbers the tag kept are still on the profile."
            }
          />
        ) : (
          <>
            <RallyStatsRow rallies={analysis.rallies} />
            {analysis.players.map((side) => (
              <PlayerSection
                key={side.id}
                player={side}
                shots={analysis.shots}
                headerExtra={
                  side.id === clip.side ? (
                    <View style={styles.named}>
                      <Text style={styles.dot}>●</Text>
                      <Text style={styles.name} numberOfLines={1}>
                        {player.name}
                      </Text>
                    </View>
                  ) : undefined
                }
              />
            ))}
            <QualityFootnote quality={analysis.quality} />
            <Text style={styles.caption}>
              Stored with the tag, without the pose track. Shot detection was audited at ~63%
              precision; shot classes are unaudited and indicative. No ball tracking.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  backLabel: { ...type.label, color: colors.accentText, flexShrink: 1 },
  centerFill: { flex: 1, justifyContent: "center", padding: spacing.md },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  cardTitle: { ...type.heading, color: colors.text },
  cardBody: { ...type.body, color: colors.textDim },
  posterWrap: { gap: spacing.xs },
  label: { ...type.label, color: colors.text },
  caption: { ...type.caption, color: colors.textDim, paddingHorizontal: spacing.xs },
  // The tagged side's name, worded the way the tag button shows it on the read-out.
  named: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  dot: { ...type.captionStrong, color: colors.accentText },
  name: { ...type.captionStrong, color: colors.accentText, flexShrink: 1 },
  pressed: { opacity: 0.7 },
});
