import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuthReady, useAuthSession } from "@/lib/auth";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { formatIsoDay, HAND_LABELS, recordingsWord } from "./display";
import { validatePlayerName } from "./shape";
import { createPlayer, listRoster, type RosterEntry } from "./store";
import { invalidateRoster } from "./useRoster";

/**
 * The roster — everyone this account has named on a read-out.
 *
 * A player here is the person IN the footage, not the signed-in user. Naming
 * Player A or Player B on any read-out tags that clip to a name; this screen
 * lists the names and how much footage sits behind each, and each opens to a
 * profile that pools it all. Rosters are private to the account that built
 * them — a club-wide view is a later, deliberate step.
 *
 * Reads on every focus (the Library's useRecordings habit): a name added from
 * a read-out moments ago is already listed when the user comes back here.
 */
export function PlayersScreen() {
  const ready = useAuthReady();
  const session = useAuthSession();
  const signedIn = session !== null;

  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRoster(await listRoster());
    } catch {
      // The store answers [] on a database error; this is the network itself
      // going away. What is on screen stays; the next focus re-reads.
    }
    setStatus("ready");
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      if (!signedIn) {
        setStatus("ready");
        return;
      }
      let live = true;
      void listRoster()
        .then((entries) => {
          if (!live) return;
          setRoster(entries);
          setStatus("ready");
        })
        .catch(() => {
          if (live) setStatus("ready");
        });
      return () => {
        live = false;
      };
    }, [ready, signedIn]),
  );

  const nameError = touched ? validatePlayerName(name) : null;

  const add = async () => {
    setTouched(true);
    if (validatePlayerName(name) !== null) return;
    setAdding(true);
    setFailure(null);
    const result = await createPlayer(name);
    setAdding(false);
    if ("error" in result) {
      setFailure(result.error);
      return;
    }
    setName("");
    setTouched(false);
    invalidateRoster();
    await refresh();
  };

  const goBack = () => {
    selectionHaptic();
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  const header = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Library"
        onPress={goBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={18} color={colors.accentText} />
        <Text style={styles.backLabel}>Library</Text>
      </Pressable>
      <ScreenHeader
        title="Players"
        subtitle={
          status === "ready" && roster.length > 0
            ? `${roster.length} on your roster`
            : "Everyone you've filmed"
        }
      />
    </>
  );

  if (!ready || status === "loading") {
    return (
      <Screen>
        {header}
        <LoadingState fill caption="Loading your roster…" />
      </Screen>
    );
  }

  if (!signedIn) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <Text style={styles.cardTitle}>Sign in to keep a roster</Text>
            <Text style={styles.cardBody}>
              Profiles are stored against your account — a name on a read-out, plus that clip&apos;s
              numbers — so they follow you to the website and any phone you sign in on. The footage
              itself never leaves this phone.
            </Text>
            <Button
              label="Sign in"
              onPress={() => {
                selectionHaptic();
                router.push("/account");
              }}
            />
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  const addCard = (
    <Card>
      <Text style={styles.fieldLabel}>Add a player</Text>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.addInput]}
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched(name.length > 0)}
          onSubmitEditing={() => void add()}
          maxLength={80}
          placeholder="Their name, as you'd say it"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          editable={!adding}
          accessibilityLabel="New player name"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add player"
          accessibilityState={{ disabled: adding }}
          disabled={adding}
          onPress={() => void add()}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed, adding && styles.disabled]}
        >
          <Ionicons name="add" size={22} color={colors.onAccent} />
        </Pressable>
      </View>
      {nameError !== null ? <Text style={styles.error}>{nameError}</Text> : null}
      {failure !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {failure}
        </Text>
      ) : null}
      <Text style={styles.caption}>
        You can also add a player from any read-out — name Player A or Player B and the recording
        is tagged to them in the same step. Naming someone twice reuses the one profile.
      </Text>
    </Card>
  );

  return (
    <Screen>
      {header}
      {roster.length === 0 ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {addCard}
          <EmptyState
            icon="people-outline"
            title="Nobody on the roster yet"
            caption="Open a read-out from the Library and name Player A or Player B. Every recording they are named on adds to their profile: time at the T, where they send it, how predictable they are, and what to exploit."
          />
        </ScrollView>
      ) : (
        <FlatList
          data={roster}
          keyExtractor={(entry) => entry.id}
          style={styles.flatList}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<View style={styles.listHeader}>{addCard}</View>}
          renderItem={({ item }) => <RosterRow entry={item} />}
        />
      )}
    </Screen>
  );
}

function RosterRow({ entry }: { entry: RosterEntry }) {
  const minutes = Math.round(entry.totalSec / 60);
  const parts = [recordingsWord(entry.recordings), `${minutes} min`];
  if (entry.lastPlayedAt !== null) parts.push(`last played ${formatIsoDay(entry.lastPlayedAt)}`);
  if (entry.hand !== null) parts.push(HAND_LABELS[entry.hand].toLowerCase());
  const meta = parts.join(" · ");
  return (
    <Card compact style={styles.rowCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${entry.name}'s profile, ${meta}`}
        onPress={() => {
          selectionHaptic();
          router.push(`/player/${entry.id}`);
        }}
        style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
      >
        <View style={styles.thumb}>
          <Ionicons name="person" size={18} color={colors.onAccent} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={2}>
            {meta}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Pressable>
    </Card>
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
  flatList: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  listHeader: { gap: spacing.sm, paddingBottom: spacing.sm },
  cardTitle: { ...type.heading, color: colors.text },
  cardBody: { ...type.body, color: colors.textDim },
  fieldLabel: { ...type.label, color: colors.textDim },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
  addInput: { flex: 1 },
  addButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  caption: { ...type.caption, color: colors.textDim },
  error: { ...type.caption, color: colors.danger },
  rowCard: { flexDirection: "row", alignItems: "center" },
  rowBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
