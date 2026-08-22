import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuthReady, useAuthSession } from "@/lib/auth";
import { notifyWarning, selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import type { MatchAnalysis, PlayerId } from "../analysis/types";
import { NamePlayerSheet, type NameChoice } from "./NamePlayerSheet";
import type { ClipRef } from "./shape";
import { createPlayer, tagClip, tagsForClip, untagClip, type ClipTag } from "./store";
import { invalidateRoster, useRoster } from "./useRoster";

interface PlayerTagButtonProps {
  side: PlayerId;
  clipRef: ClipRef;
  analysis: MatchAnalysis;
}

/** The tag this side carries, remembered with the user it was read for. */
type TagState = { uid: string; tag: ClipTag | null };

/**
 * Naming one side of a read-out — the control in a PlayerSection's header
 * that turns "Player A" into a person on the roster, and, once it has, makes
 * the name a link to everything else that person was ever tagged in.
 *
 * It is deliberately quiet. The section is about the measurements; this sits
 * beside the heading at caption weight and only opens into the sheet when
 * asked. Signed out it offers one line that leads to the Account tab and
 * nothing more: the profile is a convenience laid over the analysis, and
 * nothing here may get in the way of reading the analysis.
 *
 * Cross-feature import, documented (docs/01 rule 2): the analysis feature
 * renders this in its header because the player feature is what a read-out's
 * sides are named INTO; the analysis contract types are the shared schema.
 */
export function PlayerTagButton({ side, clipRef, analysis }: PlayerTagButtonProps) {
  const ready = useAuthReady();
  const session = useAuthSession();
  const uid = session?.user.id ?? null;
  const roster = useRoster(uid);

  // Keyed by user so an account switch can never show the previous account's
  // tag: the derived `tag` is null the moment `uid` changes, until re-read.
  const [tagState, setTagState] = useState<TagState | null>(null);
  const tag = uid !== null && tagState !== null && tagState.uid === uid ? tagState.tag : null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Callers build the ref inline, so its identity can change every render;
  // the effects key on the two ids that actually name the clip, and the
  // mutations read whatever the latest ref says. Synced in an effect, not
  // during render, as the rules of refs ask.
  const { jobId, historyId } = clipRef;
  const latestRef = useRef(clipRef);
  useEffect(() => {
    latestRef.current = clipRef;
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const label = analysis.players.find((player) => player.id === side)?.label ?? `Player ${side}`;

  // The tag this side already carries, if any. A failed read leaves the
  // control in its "untagged" state rather than showing an error — a profile
  // that cannot be reached is not a problem with the analysis.
  useEffect(() => {
    if (uid === null) return;
    let live = true;
    void tagsForClip(latestRef.current)
      .then((tags) => {
        if (live) setTagState({ uid, tag: tags.find((item) => item.side === side) ?? null });
      })
      .catch(() => {
        /* stays untagged; the next interaction re-reads */
      });
    return () => {
      live = false;
    };
  }, [uid, side, jobId, historyId]);

  const refreshTag = useCallback(async () => {
    if (uid === null) return;
    try {
      const tags = await tagsForClip(latestRef.current);
      if (mountedRef.current) {
        setTagState({ uid, tag: tags.find((item) => item.side === side) ?? null });
      }
    } catch {
      /* keep what we have */
    }
  }, [side, uid]);

  const save = useCallback(
    async (choice: NameChoice, playedAt: string) => {
      setBusy(true);
      setError(null);
      try {
        let playerId: string;
        if ("playerId" in choice) {
          playerId = choice.playerId;
        } else {
          const made = await createPlayer(choice.name);
          if ("error" in made) {
            setError(made.error);
            return;
          }
          playerId = made.player.id;
          // A new name is on the roster whether or not the tag below lands.
          invalidateRoster();
        }
        const result = await tagClip({ ref: latestRef.current, side, analysis, playerId, playedAt });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setOpen(false);
        // Recording counts on the roster moved, and so did this side's tag.
        invalidateRoster();
        await refreshTag();
      } catch {
        setError("Something went wrong. Try again.");
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [analysis, refreshTag, side],
  );

  const remove = useCallback(() => {
    if (tag === null || uid === null) return;
    notifyWarning();
    const name = tag.playerName.length > 0 ? tag.playerName : "this player";
    Alert.alert(
      `Remove ${name} from this recording?`,
      "The analysis stays in your library; only the name comes off.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            setError(null);
            void untagClip(tag.clipId)
              .then((problem) => {
                if (!mountedRef.current) return;
                if (problem !== null) {
                  setError(problem);
                  return;
                }
                setTagState({ uid, tag: null });
                invalidateRoster();
              })
              .catch(() => {
                if (mountedRef.current) setError("Something went wrong. Try again.");
              })
              .finally(() => {
                if (mountedRef.current) setBusy(false);
              });
          },
        },
      ],
    );
  }, [tag, uid]);

  // Until the session is known there is nothing true to say; a flash of
  // "Sign in" at a signed-in user would be worse than a beat of nothing.
  if (!ready) return null;

  if (session === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in to name players"
        onPress={() => {
          selectionHaptic();
          router.push("/account");
        }}
        hitSlop={spacing.sm}
        style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
      >
        <Text style={styles.quietLabel}>Sign in to name players</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      {tag !== null ? (
        <View style={styles.taggedRow}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${tag.playerName.length > 0 ? tag.playerName : "this player"}'s profile`}
            onPress={() => {
              selectionHaptic();
              router.push(`/player/${tag.playerId}`);
            }}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.nameLink, pressed && styles.pressed]}
          >
            <Text style={styles.dot}>●</Text>
            <Text style={styles.name} numberOfLines={1}>
              {tag.playerName.length > 0 ? tag.playerName : "Unnamed player"}
            </Text>
          </Pressable>
          <TextAction label="Change" onPress={() => setOpen(true)} disabled={busy} />
          <TextAction label="Remove" onPress={remove} disabled={busy} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Name ${label}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            selectionHaptic();
            setOpen(true);
          }}
          hitSlop={spacing.xs}
          style={({ pressed }) => [styles.outline, pressed && styles.pressed, busy && styles.disabled]}
        >
          <Text style={styles.outlineLabel}>Name this player</Text>
        </Pressable>
      )}
      {!open && error !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {open ? (
        // Keyed so a reopened sheet starts blank rather than on the last
        // half-typed name; the sheet itself keeps its own draft state.
        <NamePlayerSheet
          key={`${side}-${tag?.clipId ?? "none"}`}
          visible
          label={label}
          roster={roster}
          current={tag}
          defaultPlayedAt={tag?.playedAt ?? clipRef.playedAt}
          busy={busy}
          error={error}
          onSave={(choice, playedAt) => void save(choice, playedAt)}
          onClose={() => {
            setOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** "Change" / "Remove": a word, not a button-shaped button, so the tagged line reads as a line. */
function TextAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} player name`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={spacing.xs}
      style={({ pressed }) => [styles.textAction, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.textActionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", gap: 2, flexShrink: 1 },
  quiet: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center" },
  quietLabel: { ...type.caption, color: colors.accentText, textDecorationLine: "underline" },
  taggedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  nameLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET - spacing.sm,
    flexShrink: 1,
  },
  dot: { ...type.captionStrong, color: colors.accentText },
  name: { ...type.captionStrong, color: colors.accentText, flexShrink: 1 },
  textAction: { minHeight: MIN_TOUCH_TARGET - spacing.sm, justifyContent: "center" },
  textActionLabel: { ...type.captionStrong, color: colors.textDim },
  outline: {
    minHeight: MIN_TOUCH_TARGET - spacing.sm,
    paddingHorizontal: spacing.sm + spacing.xs,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
  },
  outlineLabel: { ...type.captionStrong, color: colors.text },
  error: { ...type.caption, color: colors.danger, textAlign: "right" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
