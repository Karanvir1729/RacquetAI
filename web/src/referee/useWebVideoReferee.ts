/**
 * "Score a video" on the laptop.
 *
 * Plays an analysed match and calls each rally as the playhead reaches it —
 * the phone's feature, running the phone's code. `refereeVideo` splits the
 * shot list into rallies, `advance` decides which of them the playhead has
 * passed, and `buildAnnouncement` writes the words. All three are imported
 * from the app's own source, so a scoreline can never differ between the two
 * platforms.
 *
 * The only web-specific parts are the ones that have to be: an HTMLVideoElement
 * instead of expo-video, and window.speechSynthesis instead of expo-speech.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildAnnouncement,
  DEFAULT_PLAYER_NAMES,
  type PlayerNames,
} from "@app/features/scoring/announce";
import {
  reduceSquashEvents,
} from "@app/features/scoring/squash";
import {
  DEFAULT_SQUASH_CONFIG,
  type ScoreEvent,
  type Side,
  type SquashScore,
} from "@app/features/scoring/types";
import {
  advance,
  calledBy,
  eventsAfter,
  playbackLoadCall,
} from "@app/features/scoring/videoPlayback";
import {
  DEFAULT_PLAYER_BINDING,
  flipPlayerBinding,
  refereeVideo,
  type PlayerBinding,
  type VideoRefereeResult,
} from "@app/features/scoring/videoReferee";
import type { MatchAnalysis } from "@/analysis/types";

export interface WebVideoReferee {
  result: VideoRefereeResult;
  score: SquashScore;
  events: ScoreEvent[];
  called: number;
  total: number;
  lastCall: string | null;
  detached: boolean;
  names: PlayerNames;
  /** Feed the playhead, in seconds, from the <video> timeupdate event. */
  onTime: (seconds: number) => void;
  /** The video ran out: take the whole reconstruction and say the summary. */
  onEnded: () => void;
  /** A human corrected something — playback stops writing to the score. */
  takeOver: () => void;
  awardRally: (winner: Side) => void;
  undo: () => void;
  handBack: (currentSeconds: number) => void;
  swapPlayers: () => void;
  setMuted: (muted: boolean) => void;
  muted: boolean;
}

function speak(text: string, muted: boolean): void {
  if (muted || !text) return;
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Every line is drawn on screen too; a silent browser loses nothing.
  }
}

export function useWebVideoReferee(
  analysis: MatchAnalysis,
  names: PlayerNames = DEFAULT_PLAYER_NAMES,
): WebVideoReferee {
  const [binding, setBinding] = useState<PlayerBinding>(DEFAULT_PLAYER_BINDING);
  const [events, setEvents] = useState<ScoreEvent[]>([]);
  const [called, setCalled] = useState(0);
  const [lastCall, setLastCall] = useState<string | null>(null);
  const [detached, setDetached] = useState(false);
  const [muted, setMuted] = useState(false);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  // Same lesson as useWebReferee: two timeupdate ticks can land before React
  // re-renders, so the count that decides "has this rally been called" is a
  // ref, never render state.
  const calledRef = useRef(0);
  const timeRef = useRef(0);
  const detachedRef = useRef(detached);
  detachedRef.current = detached;

  const result = useMemo(
    () => refereeVideo(analysis.shots ?? [], { binding }),
    [analysis, binding],
  );

  const score = useMemo(
    () => reduceSquashEvents(events, DEFAULT_SQUASH_CONFIG, result.firstServer),
    [events, result.firstServer],
  );

  // Re-deriving the scoreline (a player swap) clears the fold, so the called
  // count has to come back with it — the phone had a bug here where the ref
  // survived and the board stayed blank forever.
  useEffect(() => {
    calledRef.current = calledBy(result.rallies, timeRef.current);
    setCalled(calledRef.current);
    setEvents(eventsAfter(result.rallies, calledRef.current));
    setLastCall(playbackLoadCall(result.rallies.length));
  }, [result]);

  useEffect(() => () => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* nothing to cancel */
    }
  }, []);

  const onTime = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds)) return;
      timeRef.current = seconds;
      if (detachedRef.current) return;
      const step = advance(result, calledRef.current, seconds, names);
      if (step.called === calledRef.current) return;
      calledRef.current = step.called;
      setCalled(step.called);
      setEvents(eventsAfter(result.rallies, step.called));
      if (step.say) {
        setLastCall(step.say);
        speak(step.say, mutedRef.current);
      }
    },
    [result, names],
  );

  const onEnded = useCallback(() => {
    if (detachedRef.current) return;
    const total = result.rallies.length;
    if (calledRef.current === total) return;
    calledRef.current = total;
    setCalled(total);
    setEvents(eventsAfter(result.rallies, total));
    const line = playbackLoadCall(total);
    setLastCall(line);
    speak(line, mutedRef.current);
  }, [result]);

  const takeOver = useCallback(() => setDetached(true), []);

  const awardRally = useCallback(
    (winner: Side) => {
      setDetached(true);
      setEvents((current) => {
        const before = reduceSquashEvents(current, DEFAULT_SQUASH_CONFIG, result.firstServer);
        const event: ScoreEvent = {
          id: `${Date.now()}-${current.length}`,
          at: Date.now(),
          kind: "rally",
          winner,
        };
        const next = [...current, event];
        const after = reduceSquashEvents(next, DEFAULT_SQUASH_CONFIG, result.firstServer);
        const line = buildAnnouncement(before, event, after, names);
        if (line !== null) {
          setLastCall(line);
          speak(line, mutedRef.current);
        }
        return next;
      });
    },
    [result.firstServer, names],
  );

  const undo = useCallback(() => {
    setDetached(true);
    setEvents((current) => (current.length === 0 ? current : current.slice(0, -1)));
  }, []);

  /** Resume from where the playhead IS, not where it was when control was taken. */
  const handBack = useCallback(
    (currentSeconds: number) => {
      timeRef.current = currentSeconds;
      calledRef.current = calledBy(result.rallies, currentSeconds);
      setCalled(calledRef.current);
      setEvents(eventsAfter(result.rallies, calledRef.current));
      setDetached(false);
    },
    [result],
  );

  const swapPlayers = useCallback(() => setBinding((b) => flipPlayerBinding(b)), []);

  return {
    result,
    score,
    events,
    called,
    total: result.rallies.length,
    lastCall,
    detached,
    names,
    onTime,
    onEnded,
    takeOver,
    awardRally,
    undo,
    handBack,
    swapPlayers,
    muted,
    setMuted,
  };
}
