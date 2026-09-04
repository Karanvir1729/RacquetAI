import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuthReady, useAuthSession } from "@/lib/auth";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

import { buildProfileStats, clipsOnDay, scoutingNotes } from "./aggregate";
import { ContributionGrid } from "./ContributionGrid";
import { DayRecordings } from "./DayRecordings";
import { MovementChart } from "./MovementChart";
import { ProfileHeaderCard } from "./ProfileHeaderCard";
import { ProfileTendencies } from "./ProfileTendencies";
import { RecordingsList } from "./RecordingsList";
import { ScoutingNotesList } from "./ScoutingNotesList";
import type { Hand, Player, PlayerClip } from "./shape";
import { deletePlayer, getPlayer, listClips, untagClip, updatePlayer } from "./store";
import { invalidateRoster } from "./useRoster";

interface PlayerProfileScreenProps {
  id: string;
}

type Loaded = { player: Player; clips: PlayerClip[] };

/**
 * One player, every clip they were named on, rendered whole.
 *
 * Order is deliberate, as it is on the read-out. First the calendar, because
 * "how much footage is this built on" is the question that qualifies every
 * number below it (tap a day and that day's recordings open under it); then
 * the four headline figures and the tendencies (the same court plan,
 * placement grid and shot mix a single read-out draws, over the pooled
 * numbers); then court movement recording by recording, the one view the
 * pooled plan cannot give; then the scouting notes, which are the point; then
 * the recordings themselves, so every claim can be traced to the clips it
 * came from. The maths is all in aggregate.ts — this screen loads and lays out.
 *
 * The player and their clips load together, on every focus; each edit goes
 * through the store and then re-reads rather than patching state by hand, so
 * what is on screen is always what the database holds.
 */
export function PlayerProfileScreen({ id }: PlayerProfileScreenProps) {
  const ready = useAuthReady();
  const session = useAuthSession();
  const signedIn = session !== null;

  const [status, setStatus] = useState<"loading" | "missing" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [player, clips] = await Promise.all([getPlayer(id), listClips(id)]);
      if (player === null) {
        setStatus("missing");
        return;
      }
      setLoaded({ player, clips });
      setStatus("ready");
    } catch {
      // Network gone: keep whatever is on screen, or say "missing" if nothing is.
      setStatus((current) => (current === "ready" ? current : "missing"));
    }
  }, [id]);

  // Re-read on every focus, so a tag made on a read-out moments ago is
  // already in the profile when the user comes back to it.
  useFocusEffect(
    useCallback(() => {
      if (ready && signedIn) void load();
    }, [ready, signedIn, load]),
  );

  const stats = useMemo(() => (loaded === null ? null : buildProfileStats(loaded.clips)), [loaded]);
  const notes = useMemo(() => (stats === null ? [] : scoutingNotes(stats)), [stats]);

  // The calendar day whose recordings are open. Kept with the set of clip ids
  // it was chosen against and derived from there, rather than cleared in an
  // effect: a re-read on focus hands back a fresh array of the same clips and
  // the selection should survive that; it goes only when the recordings
  // themselves change (a tag removed, a new one landed).
  const clipsKey = useMemo(
    () => (loaded === null ? "" : loaded.clips.map((clip) => clip.id).join("\n")),
    [loaded],
  );
  const [daySelection, setDaySelection] = useState<{ day: string; clipsKey: string } | null>(null);
  const selectedDay = daySelection !== null && daySelection.clipsKey === clipsKey ? daySelection.day : null;
  const selectDay = useCallback(
    (day: string | null) => {
      selectionHaptic();
      setDaySelection(day === null ? null : { day, clipsKey });
    },
    [clipsKey],
  );
  const dayClips = useMemo(
    () => (loaded === null || selectedDay === null ? [] : clipsOnDay(loaded.clips, selectedDay)),
    [loaded, selectedDay],
  );

  const rename = async (name: string) => {
    const message = await updatePlayer(id, { name });
    if (message === null) {
      invalidateRoster();
      await load();
    }
    return message;
  };
  const setHand = async (hand: Hand | null) => {
    const message = await updatePlayer(id, { hand });
    if (message === null) await load();
    return message;
  };
  const setNotes = async (notesText: string) => {
    const message = await updatePlayer(id, { notes: notesText });
    if (message === null) await load();
    return message;
  };
  const remove = async () => {
    const message = await deletePlayer(id);
    if (message === null) {
      invalidateRoster();
      if (router.canGoBack()) router.back();
      else router.replace("/players");
    }
    return message;
  };
  const untag = async (clipId: string) => {
    const message = await untagClip(clipId);
    if (message === null) {
      invalidateRoster();
      await load();
    }
    return message;
  };

  const goBack = () => {
    selectionHaptic();
    if (router.canGoBack()) router.back();
    else router.replace("/players");
  };

  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Players"
      onPress={goBack}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={18} color={colors.accentText} />
      <Text style={styles.backLabel}>Players</Text>
    </Pressable>
  );

  if (!ready || (signedIn && status === "loading")) {
    return (
      <Screen>
        {back}
        <ScreenHeader title="Player" subtitle="Loading…" />
        <LoadingState fill caption="Loading the profile…" />
      </Screen>
    );
  }

  if (!signedIn) {
    return (
      <Screen>
        {back}
        <ScreenHeader title="Player" subtitle="Sign in to see profiles" />
        <View style={styles.centerFill}>
          <Card>
            <Text style={styles.cardTitle}>Sign in to see this profile</Text>
            <Text style={styles.cardBody}>
              Profiles are stored against your account and private to you.
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

  if (status === "missing" || loaded === null || stats === null) {
    return (
      <Screen>
        {back}
        <ScreenHeader title="Player" subtitle="Not on your roster" />
        <View style={styles.centerFill}>
          <EmptyState
            icon="person-outline"
            title="No such player"
            caption="This profile is not on your roster — it may have been deleted, or it belongs to another account."
          />
        </View>
      </Screen>
    );
  }

  const { player, clips } = loaded;

  return (
    <Screen>
      {back}
      <ScreenHeader
        title={player.name}
        subtitle={
          stats.recordings === 0
            ? "No recordings yet"
            : `${stats.recordings} ${stats.recordings === 1 ? "recording" : "recordings"} · ${Math.round(stats.totalSec / 60)} min analysed`
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <ProfileHeaderCard
          // Keyed on the row's values: a save that lands re-reads the player and
          // remounts the card, so its draft always starts from what is stored.
          key={`${player.name} ${player.hand ?? ""} ${player.notes}`}
          player={player}
          stats={stats}
          onRename={rename}
          onHand={setHand}
          onNotes={setNotes}
          onDelete={remove}
        />

        {clips.length === 0 ? (
          <Card>
            <Text style={styles.cardTitle}>No recordings yet</Text>
            <Text style={styles.cardBody}>
              Open a read-out from the Library and name Player A or Player B as {player.name} —
              it lands here. Every recording they are named on adds to the same profile, on this
              phone and on the website.
            </Text>
            <Button
              label="Go to Library"
              variant="secondary"
              onPress={() => {
                selectionHaptic();
                router.replace("/library");
              }}
            />
          </Card>
        ) : (
          <>
            <Card>
              <ContributionGrid clips={clips} selectedDay={selectedDay} onSelectDay={selectDay} />
              {selectedDay !== null ? (
                <DayRecordings date={selectedDay} clips={dayClips} onClose={() => selectDay(null)} />
              ) : null}
            </Card>

            <ProfileTendencies stats={stats} />

            <MovementChart clips={clips} />

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Scouting notes</Text>
              <Text style={styles.caption}>
                Rule-based, over the numbers above. Each note says what it rests on: where the
                players were, for how long, and where the ball was retrieved are measured; a shot
                class is a reading of body pose, and is marked as such.
              </Text>
            </View>
            <ScoutingNotesList notes={notes} totalShots={stats.totalShots} recordings={stats.recordings} />

            <RecordingsList playerId={id} playerName={player.name} clips={clips} onUntag={untag} />

            <Text style={styles.caveat}>
              Coverage and T-time come from player position; placement is where each shot was
              retrieved, a proxy for where it landed. Shot detection was audited at ~63% precision;
              shot classes are unaudited and indicative. No ball tracking.
              {stats.qualityPct !== null
                ? ` Both players were detected in ${Math.round(stats.qualityPct)}% of analysed frames, time-weighted across these recordings.`
                : ""}
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
  backLabel: { ...type.label, color: colors.accentText },
  centerFill: { flex: 1, justifyContent: "center", padding: spacing.md },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  cardTitle: { ...type.heading, color: colors.text },
  cardBody: { ...type.body, color: colors.textDim },
  sectionHead: { gap: spacing.xs, paddingTop: spacing.xs },
  sectionTitle: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  caveat: { ...type.caption, color: colors.textDim, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.7 },
});
