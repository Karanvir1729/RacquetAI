/**
 * State for the Score keeper screen: the event list, the score folded out of
 * it, the announcement for each call, and the disk sidecar that survives a
 * backgrounded app.
 *
 * Every mutation is "append an event and re-fold" — including undo, which is
 * "drop the last event and re-fold". Nothing here computes a score
 * incrementally, so there is no inverse operation to get wrong and no way for
 * the displayed score and the event history to disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildAnnouncement,
  correctionCall,
  DEFAULT_PLAYER_NAMES,
  matchStartCall,
  PlayerNames,
} from "./announce";
import { AUTOPILOT_ARMED_CALL } from "./autopilot";
import { createAnnouncer, SpeechWatcher } from "./speech";
import {
  readAnnouncementsMuted,
  readAutopilot,
  readAutopilotDisclosed,
  readRefereePrefs,
  writeRefereePrefs,
  readStoredMatch,
  sanitizePlayerName,
  StoredMatch,
  writeAnnouncementsMuted,
  writeAutopilot,
  writeStoredMatch,
} from "./storage";
import { applySquashEvent, reduceSquashEvents } from "./squash";
import { LetRuling, ScoreEvent, ServeBox, Side, SquashScore } from "./types";

/** Who is playing and who starts serving — everything a new match needs. */
export interface MatchSetup {
  names: PlayerNames;
  firstServer: Side;
}

export interface RefereeMatch {
  score: SquashScore;
  names: PlayerNames;
  /** False when the event list is empty; drives the Undo button. */
  canUndo: boolean;
  /** The last line announced, shown on screen so muting costs no information. */
  lastCall: string | null;
  muted: boolean;
  /**
   * Autopilot: the camera commits its own suggestion after a visible pause
   * instead of waiting for a tap. Persisted, off by default, and armed only by
   * a human — see `RefereePrefs.autopilot`.
   */
  autopilot: boolean;
  toggleAutopilot: () => void;
  /**
   * Has this user been shown what autopilot does? It is ON for a new install,
   * so the first watched session has to say so in words — see
   * `acknowledgeAutopilot`.
   */
  autopilotDisclosed: boolean;
  /**
   * Record that the disclosure has been through, with the user's answer.
   * `keep` false disarms autopilot: being told what it does and saying no is
   * the whole point of asking.
   */
  acknowledgeAutopilot: (keep: boolean) => void;
  /** False in a build without expo-speech: the screen hides the mute toggle. */
  speechAvailable: boolean;
  awardRally: (winner: Side) => void;
  ruleAppeal: (appealer: Side, ruling: LetRuling) => void;
  chooseBox: (box: ServeBox) => void;
  undo: () => void;
  startMatch: (setup: MatchSetup) => void;
  /**
   * Replace the whole match with a reconstruction — today, a video the app has
   * refereed end to end. It goes through the same commit path as a tap, so the
   * result is persisted, undoable one rally at a time, and correctable on the
   * same buttons; there is no second kind of match in this hook.
   */
  loadMatch: (setup: MatchSetup, events: ScoreEvent[], line: string | null) => void;
  /**
   * Set the event list to exactly `events`, announcing `line`, for a video
   * that is playing itself out one rally at a time.
   *
   * Deliberately NOT `loadMatch` per rally: that stops the announcer and mints
   * a fresh `startedAt`, so calling it on every tick would cut each call off
   * mid-word and keep resetting the match's age. A no-op when the list is
   * already the right length, because ticks arrive four times a second and
   * most of them change nothing.
   */
  syncVideoEvents: (events: ScoreEvent[], line: string | null) => void;
  toggleMute: () => void;
  /**
   * Watch the voice — the video player ducks the match audio under a call.
   * Delegates to the one announcer, so there is no second speech pipeline to
   * keep in step with mute.
   */
  watchSpeech: (watcher: SpeechWatcher) => () => void;
  /**
   * Speak a line that is NOT a scoring call — today, the court-watcher's
   * question. It goes through the SAME announcer as the calls, so a question
   * and a call can never talk over each other, and it obeys the same mute.
   *
   * It deliberately does not touch `lastCall`: that line is the record of what
   * was actually scored, and a question the app asked has no business
   * appearing there.
   */
  say: (line: string) => void;
}

// Unique within a session; persisted ids are kept as-is on restore. Ids only
// have to be stable list keys, so a counter beats a uuid dependency.
let eventSeq = 0;

function eventBase(): { id: string; at: number } {
  eventSeq += 1;
  const at = Date.now();
  return { id: `${at}-${eventSeq}`, at };
}

/**
 * Are two event lists the same run of rallies?
 *
 * Compared by id, which `eventBase()` mints uniquely per event, so this is an
 * identity check and not a deep compare — cheap enough for the playback ticks
 * it runs on, where the common case is "nothing changed" and the first length
 * test short-circuits.
 */
function sameEvents(a: ScoreEvent[], b: ScoreEvent[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/** A blank match with the default names, ready to score immediately. */
function createStoredMatch(setup?: MatchSetup): StoredMatch {
  return {
    v: 1,
    startedAt: new Date().toISOString(),
    names: {
      A: sanitizePlayerName(setup?.names.A, DEFAULT_PLAYER_NAMES.A),
      B: sanitizePlayerName(setup?.names.B, DEFAULT_PLAYER_NAMES.B),
    },
    firstServer: setup?.firstServer ?? "A",
    events: [],
  };
}

/**
 * A match is only resumed while it could plausibly still be being played. A
 * squash match runs well under two hours, so a stored one older than this is
 * last session's — and silently handing someone last week's 7-5 as the live
 * score, then reading it aloud as fact, is worse than starting fresh.
 */
const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

function resumableMatch(): StoredMatch | null {
  const stored = readStoredMatch();
  if (stored === null) return null;
  // The LATER of "when this match was started" and "when it was last scored".
  // Taking the last event alone would drop a refereed video the moment the app
  // was backgrounded: its rally events are stamped in VIDEO time (seconds from
  // the start of the footage), which is a moment in 1970, so the match would
  // look hours stale within a second of being created.
  const started = Date.parse(stored.startedAt);
  const lastEvent = stored.events.at(-1)?.at ?? Number.NEGATIVE_INFINITY;
  const last = Math.max(Number.isFinite(started) ? started : Number.NEGATIVE_INFINITY, lastEvent);
  if (!Number.isFinite(last) || Date.now() - last > RESUME_WINDOW_MS) return null;
  return stored;
}

export function useRefereeMatch(): RefereeMatch {
  // Read the sidecar synchronously in the initializer, the hasSeenTutorial
  // pattern: deferring to an effect would show 0-0 for a frame and then snap
  // to the real score, which on a scoreboard reads as a bug.
  const [match, setMatch] = useState<StoredMatch>(() => resumableMatch() ?? createStoredMatch());
  /** Authoritative between renders; see the note in `commit`. */
  const matchRef = useRef(match);
  const [muted, setMuted] = useState<boolean>(readAnnouncementsMuted);
  const [autopilot, setAutopilot] = useState<boolean>(readAutopilot);
  const [autopilotDisclosed, setAutopilotDisclosed] = useState<boolean>(readAutopilotDisclosed);
  const [lastCall, setLastCall] = useState<string | null>(null);

  // One announcer for the life of the screen. A lazy useState initializer
  // rather than useMemo: loading the native module is a side effect that must
  // happen exactly once, and useMemo is explicitly allowed to re-run.
  const [announcer] = useState(createAnnouncer);

  // Leaving the screen mid-sentence must not leave a voice talking over the
  // next rally.
  useEffect(() => () => announcer.stop(), [announcer]);

  const score = useMemo(
    () => reduceSquashEvents(match.events, undefined, match.firstServer),
    [match.events, match.firstServer],
  );

  const commit = useCallback(
    (next: StoredMatch, line: string | null) => {
      // The ref moves SYNCHRONOUSLY, before setState. Two rally taps can land
      // in one React batch (two thumbs, or a double-tap), and reading the
      // match from the render closure would fold both from the same snapshot
      // — the second overwrites the first and a point silently disappears.
      // On a scoreboard that is the worst possible bug: nothing looks wrong.
      matchRef.current = next;
      setMatch(next);
      writeStoredMatch(next);
      if (line === null) return;
      setLastCall(line);
      if (!muted) announcer.say(line);
    },
    [announcer, muted],
  );

  const record = useCallback(
    (event: ScoreEvent) => {
      // Re-derive from the ref rather than the closure, for the reason above.
      // Folding a handful of events is far cheaper than a dropped point.
      const current = matchRef.current;
      const currentScore = reduceSquashEvents(current.events, undefined, current.firstServer);
      // The match is decided: the reducer would ignore this anyway, and
      // appending it would make Undo take two taps to do anything visible.
      if (currentScore.winner !== null) return;
      const after = applySquashEvent(currentScore, event);
      commit(
        { ...current, events: [...current.events, event] },
        buildAnnouncement(currentScore, event, after, current.names),
      );
    },
    [commit],
  );

  const awardRally = useCallback(
    (winner: Side) => record({ ...eventBase(), kind: "rally", winner }),
    [record],
  );

  const ruleAppeal = useCallback(
    (appealer: Side, ruling: LetRuling) =>
      record({ ...eventBase(), kind: "let-decision", appealer, ruling }),
    [record],
  );

  const chooseBox = useCallback(
    (box: ServeBox) => record({ ...eventBase(), kind: "serve-box", box }),
    [record],
  );

  const undo = useCallback(() => {
    // Ref, not closure — same batching reason as `record`.
    const current = matchRef.current;
    if (current.events.length === 0) return;
    const events = current.events.slice(0, -1);
    const next = { ...current, events };
    // Announce the score we have gone BACK to, prefixed as a correction —
    // otherwise players hear a score with no way to tell it from a new rally.
    commit(
      next,
      correctionCall(reduceSquashEvents(events, undefined, current.firstServer), current.names),
    );
  }, [commit]);

  const startMatch = useCallback(
    (setup: MatchSetup) => {
      announcer.stop();
      const next = createStoredMatch(setup);
      setLastCall(null);
      commit(next, matchStartCall(next.names, next.firstServer));
    },
    [announcer, commit],
  );

  const loadMatch = useCallback(
    (setup: MatchSetup, events: ScoreEvent[], line: string | null) => {
      announcer.stop();
      setLastCall(null);
      commit({ ...createStoredMatch(setup), events }, line);
    },
    [announcer, commit],
  );

  const syncVideoEvents = useCallback(
    (events: ScoreEvent[], line: string | null) => {
      const current = matchRef.current;
      // Length is NOT enough. A manual action mid-playback replaces an event
      // rather than adding one — rule a let, or correct a rally — so the video
      // prefix and the live match can have the same COUNT and different
      // contents. Returning early there dropped the next rally on the floor
      // silently, and permanently when it was the last one. Compare contents.
      if (sameEvents(current.events, events)) return;
      commit({ ...current, events }, line);
    },
    [commit],
  );

  const watchSpeech = useCallback(
    (watcher: SpeechWatcher) => announcer.watch(watcher),
    [announcer],
  );

  const say = useCallback(
    (line: string) => {
      if (muted || line.length === 0) return;
      announcer.say(line);
    },
    [announcer, muted],
  );

  const acknowledgeAutopilot = useCallback(
    (keep: boolean) => {
      setAutopilot(keep);
      setAutopilotDisclosed(true);
      writeRefereePrefs({ ...readRefereePrefs(), autopilot: keep, autopilotDisclosed: true });
    },
    [],
  );

  const toggleAutopilot = useCallback(() => {
    const next = !autopilot;
    setAutopilot(next);
    writeAutopilot(next);
    // Arming it is said out loud, and phrased as a warning rather than a
    // confirmation: from here the app changes the score by itself, and the two
    // people on court cannot see the switch from the back of the T.
    if (next && !muted) announcer.say(AUTOPILOT_ARMED_CALL);
  }, [announcer, autopilot, muted]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    writeAnnouncementsMuted(next);
    // Cut the sentence in flight, or muting mid-announcement does nothing.
    if (next) announcer.stop();
  }, [announcer, muted]);

  return {
    score,
    names: match.names,
    canUndo: match.events.length > 0,
    lastCall,
    muted,
    autopilot,
    toggleAutopilot,
    autopilotDisclosed,
    acknowledgeAutopilot,
    speechAvailable: announcer.available,
    awardRally,
    ruleAppeal,
    chooseBox,
    undo,
    startMatch,
    loadMatch,
    syncVideoEvents,
    toggleMute,
    watchSpeech,
    say,
  };
}
