/**
 * The referee, on a laptop.
 *
 * This is deliberately NOT a port. `@app/features/scoring/*` is the exact
 * TypeScript the phone runs — the PAR-11 rules, the marker's wording, the undo
 * fold — imported through the `@app` alias (web/vite.config.ts). The only
 * things that differ between the two platforms are the two things that must:
 * how a voice is produced, and where the match is stored.
 *
 *   phone: expo-speech            laptop: window.speechSynthesis
 *   phone: documents sidecar      laptop: localStorage
 *
 * Keeping the rules shared is the point. web/src/analysis was ported by hand
 * and drifted from its app twin — the heatmap renders differently on the two
 * platforms today because of it. The scoreline must never be able to disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildAnnouncement,
  correctionCall,
  DEFAULT_PLAYER_NAMES,
  matchStartCall,
  type PlayerNames,
} from "@app/features/scoring/announce";
import {
  createSquashScore,
  reduceSquashEvents,
} from "@app/features/scoring/squash";
import {
  DEFAULT_SQUASH_CONFIG,
  type LetRuling,
  type ScoreEvent,
  type ServeBox,
  type Side,
  type SquashScore,
} from "@app/features/scoring/types";

const STORAGE_KEY = "racketiq-referee-match-v1";

/** Mirrors the app's StoredMatch closely enough to be recognisable in a debug dump. */
interface StoredMatch {
  v: 1;
  names: PlayerNames;
  firstServer: Side;
  events: ScoreEvent[];
  updatedAt: number;
}

let seq = 0;
function eventBase(): { id: string; at: number } {
  seq += 1;
  const at = Date.now();
  return { id: `${at}-${seq}`, at };
}

function blank(names: PlayerNames, firstServer: Side): StoredMatch {
  return { v: 1, names, firstServer, events: [], updatedAt: Date.now() };
}

/** Never throws: a corrupt or absent entry reads as "no match in progress". */
function load(): StoredMatch | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const match = parsed as Partial<StoredMatch>;
    if (match.v !== 1 || !Array.isArray(match.events)) return null;
    return {
      v: 1,
      names: match.names ?? DEFAULT_PLAYER_NAMES,
      firstServer: match.firstServer === "B" ? "B" : "A",
      events: match.events,
      updatedAt: match.updatedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

function save(match: StoredMatch): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
  } catch {
    // A full or blocked storage must never stop the score advancing.
  }
}

/**
 * Speak a line, cancelling whatever was mid-sentence.
 *
 * The browser's speech engine is the one piece with no phone equivalent to
 * share. `cancel()` before `speak()` matches the app's announcer: a correction
 * must interrupt the call it corrects, not queue behind it.
 */
function createVoice() {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function";
  return {
    supported,
    say(text: string, muted: boolean) {
      if (!supported || muted || text.length === 0) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(text);
        // Slower than default: a marker calls the score to be understood across
        // a court, not to be quick.
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
      } catch {
        // A browser that refuses to speak still shows every line on screen.
      }
    },
    silence() {
      if (!supported) return;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* nothing to cancel */
      }
    },
  };
}

export interface WebReferee {
  score: SquashScore;
  names: PlayerNames;
  lastCall: string | null;
  canUndo: boolean;
  matchOver: boolean;
  muted: boolean;
  speechSupported: boolean;
  setMuted: (muted: boolean) => void;
  awardRally: (winner: Side) => void;
  ruleAppeal: (appealer: Side, ruling: LetRuling) => void;
  chooseBox: (box: ServeBox) => void;
  undo: () => void;
  startMatch: (names: PlayerNames, firstServer: Side) => void;
}

export function useWebReferee(): WebReferee {
  const voice = useMemo(createVoice, []);
  const [match, setMatch] = useState<StoredMatch>(
    () => load() ?? blank(DEFAULT_PLAYER_NAMES, "A"),
  );
  const [lastCall, setLastCall] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => save(match), [match]);
  // Leaving the page mid-sentence should not leave a voice talking to an empty
  // room; browsers keep speaking after navigation otherwise.
  useEffect(() => () => voice.silence(), [voice]);

  const score = useMemo(
    () =>
      reduceSquashEvents(match.events, DEFAULT_SQUASH_CONFIG, match.firstServer),
    [match.events, match.firstServer],
  );

  // The live match, readable synchronously. Two rally taps in the same tick
  // (or React batching two clicks) both read the SAME render's `match` — so
  // deriving the announcement from render state announced the first rally
  // twice while the score itself, updated functionally, ran ahead. The app
  // solves this with matchRef.current; so does this.
  const matchRef = useRef(match);
  matchRef.current = match;

  /**
   * Append an event and say whatever the shared announcer decides is worth
   * saying. Both the before- and after-score are folded from `matchRef`, never
   * from render state, so a burst of taps calls each rally correctly.
   */
  const commit = useCallback(
    (event: ScoreEvent) => {
      const current = matchRef.current;
      const before = reduceSquashEvents(
        current.events,
        DEFAULT_SQUASH_CONFIG,
        current.firstServer,
      );
      const events = [...current.events, event];
      const after = reduceSquashEvents(events, DEFAULT_SQUASH_CONFIG, current.firstServer);
      const next = { ...current, events, updatedAt: Date.now() };
      matchRef.current = next;
      setMatch(next);

      const line = buildAnnouncement(before, event, after, current.names);
      if (line !== null) {
        setLastCall(line);
        voice.say(line, mutedRef.current);
      }
    },
    [voice],
  );

  const awardRally = useCallback(
    (winner: Side) => commit({ ...eventBase(), kind: "rally", winner }),
    [commit],
  );

  // Routed through the shared reducer (applySquashLetDecision, via
  // reduceSquashEvents) so a stroke or no-let awards the point exactly as it
  // does on the phone.
  const ruleAppeal = useCallback(
    (appealer: Side, ruling: LetRuling) =>
      commit({ ...eventBase(), kind: "let-decision", appealer, ruling }),
    [commit],
  );

  const chooseBox = useCallback(
    (box: ServeBox) => commit({ ...eventBase(), kind: "serve-box", box }),
    [commit],
  );

  /**
   * Undo drops the last event and re-folds, rather than inverting it — the same
   * choice the app makes, and the reason undo across a game boundary is correct
   * instead of approximately correct.
   */
  const undo = useCallback(() => {
    const current = matchRef.current;
    if (current.events.length === 0) return;
    const events = current.events.slice(0, -1);
    const next = { ...current, events, updatedAt: Date.now() };
    matchRef.current = next;
    setMatch(next);
    const after = reduceSquashEvents(events, DEFAULT_SQUASH_CONFIG, current.firstServer);
    const line = correctionCall(after, current.names);
    setLastCall(line);
    voice.say(line, mutedRef.current);
  }, [voice]);

  const startMatch = useCallback(
    (names: PlayerNames, firstServer: Side) => {
      const fresh = blank(names, firstServer);
      matchRef.current = fresh;
      setMatch(fresh);
      const line = matchStartCall(names, firstServer);
      setLastCall(line);
      voice.say(line, mutedRef.current);
    },
    [voice],
  );

  return {
    score,
    names: match.names,
    lastCall,
    canUndo: match.events.length > 0,
    matchOver: score.winner !== null,
    muted,
    speechSupported: voice.supported,
    setMuted,
    awardRally,
    ruleAppeal,
    chooseBox,
    undo,
    startMatch,
  };
}

/** Exported for the page's empty state. */
export { createSquashScore, DEFAULT_PLAYER_NAMES };
