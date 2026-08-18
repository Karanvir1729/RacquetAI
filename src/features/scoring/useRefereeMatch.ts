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
import { createAnnouncer } from "./speech";
import {
  readAnnouncementsMuted,
  readStoredMatch,
  sanitizePlayerName,
  StoredMatch,
  writeAnnouncementsMuted,
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
  /** False in a build without expo-speech: the screen hides the mute toggle. */
  speechAvailable: boolean;
  awardRally: (winner: Side) => void;
  ruleAppeal: (appealer: Side, ruling: LetRuling) => void;
  chooseBox: (box: ServeBox) => void;
  undo: () => void;
  startMatch: (setup: MatchSetup) => void;
  toggleMute: () => void;
}

// Unique within a session; persisted ids are kept as-is on restore. Ids only
// have to be stable list keys, so a counter beats a uuid dependency.
let eventSeq = 0;

function eventBase(): { id: string; at: number } {
  eventSeq += 1;
  const at = Date.now();
  return { id: `${at}-${eventSeq}`, at };
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
  const last = stored.events.at(-1)?.at ?? Date.parse(stored.startedAt);
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
    speechAvailable: announcer.available,
    awardRally,
    ruleAppeal,
    chooseBox,
    undo,
    startMatch,
    toggleMute,
  };
}
