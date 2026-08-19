/**
 * The autopilot clock. `autopilot.ts` decides WHETHER a rally may be scored by
 * the app; this owns the countdown that gives a human time to stop it.
 *
 * One timer, keyed on the proposal's arrival time. Two rules keep it honest:
 *
 * - a proposal that arrives while autopilot is off, or that the engine could
 *   only `ask` about, never starts a clock at all — so turning autopilot off
 *   restores the exact behaviour the screen had before it existed;
 * - the clock is cancelled by unmount, by the question being answered or
 *   dismissed, by play resuming, and by autopilot being switched off mid-count.
 *   A fired timer whose question is gone must never award anything.
 */
import { useEffect, useRef, useState } from "react";

import { AUTOPILOT_DELAY_MS, autopilotWinner, secondsLeft } from "./autopilot";
import type { RallyProposal } from "./liveClient";
import type { ProposalLevel } from "./proposal";
import type { Side } from "./types";

export interface AutopilotCountdown {
  /** The side about to be given the point, or null when nothing is pending. */
  pending: Side | null;
  /** Whole seconds remaining, for the label. */
  seconds: number;
}

export interface UseAutopilotOptions {
  proposal: RallyProposal | null;
  level: ProposalLevel;
  enabled: boolean;
  /** Called once, with the winner, when the countdown runs out. */
  onCommit: (winner: Side) => void;
  /** Injectable for tests; the screen never passes it. */
  delayMs?: number;
}

export function useAutopilot({
  proposal,
  level,
  enabled,
  onCommit,
  delayMs = AUTOPILOT_DELAY_MS,
}: UseAutopilotOptions): AutopilotCountdown {
  const winner = autopilotWinner(proposal, level, enabled);
  // The question's own arrival time identifies it. Keying on the object would
  // restart the countdown every time the proposal is rebuilt — which it is,
  // on every binding swap — and a countdown that resets when you correct the
  // player binding would never expire.
  const key = winner === null ? null : (proposal?.at ?? null);

  // The label, reset to the full delay the moment a new question arrives —
  // React's adjust-state-during-render pattern, and PURE: the opening value is
  // arithmetic on the delay, never a clock reading. Reading the time during
  // render is what makes a component unable to be re-run safely, and the
  // opening value does not need it, because a countdown always starts full.
  const [clockKey, setClockKey] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(() => secondsLeft(0, delayMs));
  if (clockKey !== key) {
    setClockKey(key);
    setSeconds(secondsLeft(0, delayMs));
  }

  // The callback in a ref: the screen rebuilds it on every render, and a fresh
  // identity in the effect's deps would tear down and restart the timer each
  // time, so the countdown could never actually reach zero.
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (key === null || winner === null) return;
    // Measured against a start time taken here rather than accumulated by the
    // interval: a background tab or a slow frame drops ticks, and a counter
    // that decrements per tick would drift away from the timeout that is
    // actually going to score the point.
    const startedAt = Date.now();
    const ticker = setInterval(
      () => setSeconds(secondsLeft(Date.now() - startedAt, delayMs)),
      250,
    );
    const fire = setTimeout(() => commitRef.current(winner), delayMs);
    return () => {
      clearInterval(ticker);
      clearTimeout(fire);
    };
    // `winner` is intentionally in the deps alongside `key`: a binding swap
    // mid-count changes WHO the point would go to, and that has to restart the
    // clock rather than fire the old answer.
  }, [key, winner, delayMs]);

  return { pending: winner, seconds: winner === null ? 0 : seconds };
}
