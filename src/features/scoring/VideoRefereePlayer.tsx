/**
 * The video refereeing itself, out loud, while you watch.
 *
 * The footage plays, and as the playhead passes each rally's end the app makes
 * the marker's call — same wording, same voice, same announcer as a rally
 * somebody tapped — and the scoreboard moves with it. This is the feature at
 * its most demonstrable: nobody has to believe a scoreline, they can watch it
 * being built.
 *
 * ---------------------------------------------------------------------------
 * THE SCORE FOLLOWS THE PLAYHEAD, NOT THE OTHER WAY AROUND.
 * ---------------------------------------------------------------------------
 * Every update asks `videoPlayback.advance` where the playhead is and takes
 * the answer whole. Scrub backwards and the score rewinds; scrub forwards and
 * it catches up in one step; land on the same second twice and it reads the
 * same both times. Nothing in here accumulates, so nothing in here can drift.
 *
 * ---------------------------------------------------------------------------
 * THE AUDIO PROBLEM, WHICH IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * On iOS the video's audio and the spoken call go into the SAME audio session
 * and sum at full volume — neither ducks the other. A squash video's audio is
 * ball strikes and court echo, which is exactly the frequency range a voice
 * lives in, so an un-ducked call is not quiet, it is unintelligible. The
 * announcer therefore tells this screen when it starts and stops speaking
 * (`Announcer.watch`) and the video drops to `DUCKED_VOLUME` for the length of
 * the line. The watcher contract guarantees the restore always runs — including
 * when expo-speech never calls back — because a video left permanently silent
 * is a worse bug than the one being fixed.
 *
 * `audioMixingMode: "mixWithOthers"` is separate and also required: expo-video's
 * iOS default takes the session exclusively, which would kill the user's music
 * the moment this screen opens and leave the app holding it afterwards.
 */
import { useEventListener } from "expo";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { formatClock } from "@/lib/format";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { PoseOverlay, PLAYER_COLORS } from "@/features/analysis/PoseOverlay";
import { nearestTrackIndex } from "@/features/analysis/pose";
import type { Size } from "@/features/analysis/letterbox";
import type { PlayerId, TrackFrame } from "@/features/analysis/types";

import { PlayerNames } from "./announce";
import type { SpeechWatcher } from "./speech";
import { ScoreEvent } from "./types";
import {
  advance,
  calledBy,
  eventsAfter,
  nextRallyStart,
  playbackNote,
} from "./videoPlayback";
import { PlayerBinding, sideForPlayer, VideoRefereeResult } from "./videoReferee";
import { videoLoadCall } from "./useVideoReferee";

/**
 * How far the match audio drops while a call is being made. Not zero: the
 * point of watching is to hear the rally, and cutting it dead for three
 * seconds after every point makes the footage feel broken. Low enough that a
 * voice sits clearly on top of a ball strike.
 */
const DUCKED_VOLUME = 0.15;

/**
 * How often the playhead is sampled.
 *
 * Following only RALLY ENDS, a quarter second is plenty — they are seconds
 * apart and every tick is a bridge crossing. With pose tracks to draw, the
 * skeletons are the thing on screen and they are sampled at ~8 Hz, so the
 * tick matches MatchVideoCard's 0.125 s; anything coarser makes the figures
 * stutter behind the players they are pinned to.
 */
const RALLY_TICK_SEC = 0.25;
const POSE_TICK_SEC = 0.125;

const KEEP_AWAKE_TAG = "racquetiq-referee-video";

/**
 * Every write to the native player goes through these two.
 *
 * The player is a shared native object handed back by a hook, and mutating it
 * from component scope is what the compiler's immutability rule exists to
 * catch. Taking it as a parameter puts the mutation somewhere honest, and
 * having exactly two writers means every path that can leave the video quiet
 * or running is visible in one place.
 */
function setVolume(player: { volume: number }, value: number): void {
  try {
    player.volume = value;
  } catch {
    // A released player has no volume to set — never worth a crash.
  }
}

function pause(player: { pause: () => void }): void {
  try {
    player.pause();
  } catch {
    // Already released, or not yet ready: nothing to pause either way.
  }
}

interface VideoRefereePlayerProps {
  videoUri: string;
  result: VideoRefereeResult;
  names: PlayerNames;
  /**
   * Subscribe to the screen's announcer — the SAME one the scoreboard speaks
   * through, so the duck is tied to the actual voice rather than to a guess at
   * how long a line takes. Returns an unsubscribe.
   */
  watchSpeech: (watcher: SpeechWatcher) => () => void;
  muted: boolean;
  /**
   * True once a human has corrected something. Playback then stops writing to
   * the score entirely — see the note on `detached` below.
   */
  detached: boolean;
  /** Short phone: the video gives back height the scoreboard cannot spare. */
  compact: boolean;
  /**
   * Pose samples to draw over the footage, when the analysis carries them
   * (schema v2). Null hides the whole overlay layer — a v1 analysis plays
   * exactly as before.
   */
  tracks: readonly TrackFrame[] | null;
  /** The ANALYSED frame size, for letterboxing the overlay onto the box. */
  videoSize: Size | null;
  /** Which tracker identity is which side — the legend follows the swap. */
  binding: PlayerBinding;
  /** Hand scoring back to the video from wherever the playhead now is. */
  onReattach: () => void;
  /**
   * Called whenever the playhead implies a different set of rallies, with the
   * line to announce (null when `advance` decided nothing should be said).
   * The screen folds these into the ordinary match, so undo and the manual
   * buttons keep working on a video that is still playing.
   */
  onSync: (events: ScoreEvent[], line: string | null) => void;
}

export function VideoRefereePlayer({
  videoUri,
  result,
  names,
  watchSpeech,
  muted,
  detached,
  compact,
  tracks,
  videoSize,
  binding,
  onReattach,
  onSync,
}: VideoRefereePlayerProps) {
  const hasTracks = tracks !== null && tracks.length > 0;
  const player = useVideoPlayer(videoUri, (instance) => {
    instance.loop = false;
    instance.muted = false;
    instance.timeUpdateEventInterval = hasTracks ? POSE_TICK_SEC : RALLY_TICK_SEC;
    // See the file comment: expo-video's iOS default takes the audio session
    // exclusively, which stops the user's music the moment this mounts.
    instance.audioMixingMode = "mixWithOthers";
  });

  // How many rallies the playhead has passed. Two copies on purpose: the state
  // is what gets drawn, and the ref is what the next tick compares against.
  // The ref is written ONLY from the event callback — never during render —
  // because two ticks can land before React re-renders, and a comparison
  // against the rendered value would then re-announce a rally already called.
  const [called, setCalled] = useState(0);
  const calledRef = useRef(0);
  /** Where the playhead was last seen, so reattaching can resume from it. */
  const timeRef = useRef(0);

  // A NEW result — "Swap players", or "X served first" — is a different
  // scoreline over the same footage, and the parent clears the events to fold
  // it again. `calledRef` is a ref, so it survived that and kept its old count:
  // on a video already played to the end it stayed at the total, every
  // `advance` and `playToEnd` early-returned, and the board sat at 0-0 forever
  // while the caption still read "All N rallies called". Re-derive the count
  // from where the playhead actually is whenever the result identity changes,
  // and re-sync so the board matches immediately.
  useEffect(() => {
    calledRef.current = calledBy(result.rallies, timeRef.current);
    setCalled(calledRef.current);
    if (!detached) {
      onSync(eventsAfter(result.rallies, calledRef.current), null);
    }
    // Keyed on the result identity alone: this must run when the scoreline is
    // re-derived, not on every tick that changes `detached` or the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  // The overlay pieces, the MatchVideoCard recipe: the measured box for
  // letterboxing, and an INDEX into the track samples rather than the raw
  // time, so a tick that lands on the same sample re-renders nothing. Seeded
  // at t=0 so the poster frame already carries skeletons.
  const [boxSize, setBoxSize] = useState<Size | null>(null);
  const [frameIndex, setFrameIndex] = useState<number | null>(() =>
    hasTracks ? nearestTrackIndex(tracks, 0) : null,
  );

  // `useEventListener` keeps the newest listener in a ref, so this inline arrow
  // sees the current props on every tick and never goes stale — the same
  // reason MatchVideoCard writes its listener inline.
  //
  // The side effects live HERE, in the event, and never inside a setState
  // updater: an updater must be pure, and React is free to run it twice, which
  // would announce every rally twice and write the events twice.
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    // A player that has not loaded yet reports NaN. Folding that would count
    // zero rallies and yank the score back to 0-0 for a frame.
    if (!Number.isFinite(currentTime)) return;
    timeRef.current = currentTime;
    if (hasTracks) setFrameIndex(nearestTrackIndex(tracks, currentTime));
    // A human has taken over. The playhead keeps moving — they may well be
    // re-watching the rally they just corrected — but it no longer touches the
    // score, or the next crossing would quietly undo their correction.
    if (detached) return;
    const step = advance(result, calledRef.current, currentTime, names);
    if (step.called === calledRef.current) return;
    calledRef.current = step.called;
    setCalled(step.called);
    onSync(eventsAfter(result.rallies, step.called), step.say);
  });

  // The last rally's call lands `CALL_DELAY_SEC` after its final strike, and on
  // footage that stops promptly that moment can be past the end of the file —
  // so the same analysis would score one rally lower played than folded. At the
  // end, take the whole prefix and say the summary the one-pass path says.
  useEventListener(player, "playToEnd", () => {
    if (detached) return;
    const total = result.rallies.length;
    if (calledRef.current === total) return;
    calledRef.current = total;
    setCalled(total);
    onSync(eventsAfter(result.rallies, total), videoLoadCall(result, names));
  });

  // Taking over stops the footage and lifts the duck. A video that keeps
  // playing while it no longer scores is the genuinely confusing state: the
  // rallies go by and the board does not move, with nothing to say why.
  useEffect(() => {
    if (!detached) return;
    pause(player);
    setVolume(player, 1);
  }, [detached, player]);

  // Duck the match audio under the call. The watcher is balanced by contract,
  // so the restore runs even when expo-speech never reports the line finishing.
  useEffect(() => {
    return watchSpeech({
      onStart: () => setVolume(player, DUCKED_VOLUME),
      onEnd: () => setVolume(player, 1),
    });
  }, [watchSpeech, player]);

  // A 45-minute match plays for 45 minutes. Without this the phone locks
  // halfway through the second game — the same reason the live referee holds
  // it while the camera is on.
  useEffect(() => {
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  // Backgrounding pauses. Otherwise the app carries on calling the score into
  // a pocket, and comes back several games further on than the user left it.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") return;
      // Not just "background": a call or Control Centre pull ("inactive")
      // silences the video too, and calling the score into a phone the user
      // is not looking at is how a match ends up several games further on
      // than they left it.
      pause(player);
      setVolume(player, 1);
    });
    return () => subscription.remove();
  }, [player]);

  const handBackToVideo = () => {
    selectionHaptic();
    // Resume from where the playhead actually IS, not from where it was when
    // the human took over: they may have scrubbed while detached, and picking
    // up at a stale count would replay rallies that are already on the board.
    calledRef.current = calledBy(result.rallies, timeRef.current);
    setCalled(calledRef.current);
    onReattach();
    // Taking over paused the footage; handing back should not leave the user
    // hunting for the native play control to finish the exchange.
    try {
      player.play();
    } catch {
      // Not ready yet — the next tap on the native controls resumes it.
    }
  };

  const skipToNextRally = () => {
    selectionHaptic();
    const target = nextRallyStart(result, calledRef.current);
    if (target === null) return;
    try {
      // Relative, not an assignment to `currentTime`: the player is a shared
      // native object and writing its properties from a handler is what the
      // compiler's immutability rule exists to stop.
      player.seekBy(target - player.currentTime);
      player.play();
    } catch {
      // Seeking a player that is not ready is a no-op, not a failure.
    }
  };

  const total = result.rallies.length;
  const upNext = result.rallies[called];

  return (
    <View style={styles.wrap}>
      <View
        style={[styles.videoBox, { maxHeight: compact ? 128 : 168 }]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setBoxSize({ width, height });
        }}
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
        />
        {/* Non-interactive by construction (PoseOverlay), so the native
            transport controls underneath still take every touch. */}
        {hasTracks && videoSize !== null ? (
          <PoseOverlay
            frame={frameIndex !== null ? (tracks[frameIndex] ?? null) : null}
            videoSize={videoSize}
            boxSize={boxSize}
          />
        ) : null}
      </View>
      {hasTracks ? (
        <View style={styles.legend}>
          {(["A", "B"] as PlayerId[]).map((id) => (
            <View key={id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: PLAYER_COLORS[id] }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>
                {/* The tracker's "A" maps through the SAME binding the score
                    uses, so Swap players recolors these names in step with
                    the rallies it re-awards. */}
                {names[sideForPlayer(id, binding)]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.note} numberOfLines={2}>
          {detached
            ? "You corrected a rally, so the video has stopped scoring. The score is yours now."
            : playbackNote(called, total)}
        </Text>
        {muted ? <Text style={styles.mutedTag}>Muted</Text> : null}
      </View>
      {detached ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hand scoring back to the video from here"
          onPress={handBackToVideo}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Ionicons name="play-forward" size={15} color={colors.accentText} />
          <Text style={styles.skipLabel} numberOfLines={1}>
            Let the video carry on from here
          </Text>
        </Pressable>
      ) : null}
      {upNext === undefined || detached ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip to rally ${upNext.index}, at ${formatClock(upNext.startSec)}`}
          onPress={skipToNextRally}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Ionicons name="play-skip-forward" size={15} color={colors.accentText} />
          <Text style={styles.skipLabel} numberOfLines={1}>
            {/* A real match is mostly not rallies. On a 45-minute file the
                walk back to the service box is the majority of the footage,
                and a demo cannot stand in it. */}
            Skip to rally {upNext.index} · {formatClock(upNext.startSec)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  videoBox: {
    aspectRatio: 16 / 9,
    // Capped: this screen does not scroll, and a full-width 16:9 box on a
    // 402pt phone is 226pt the scoreboard and the rally buttons need more.
    alignSelf: "stretch",
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.panel,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  note: { ...type.caption, color: colors.textDim, flex: 1 },
  mutedTag: { ...type.caption, color: colors.textFaint },
  skip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET * 0.75,
  },
  skipLabel: { ...type.caption, color: colors.accentText },
  legend: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
