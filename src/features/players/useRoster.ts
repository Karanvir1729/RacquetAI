/**
 * One roster fetch per read-out. Both tag buttons mount together (Player A,
 * Player B) and would otherwise each ask Supabase for the same list; instead
 * the promise is cached — keyed by user, so an account switch can never read
 * the previous account's names — until a mutation invalidates it.
 * Invalidation also pokes every mounted consumer into re-fetching, so naming
 * Player A as someone new puts them in Player B's list straight away. The
 * web's PlayerTagControl keeps the same cache for the same reason.
 */
import { useEffect, useState } from "react";

import { listRoster, type RosterEntry } from "./store";

let cached: { uid: string; promise: Promise<RosterEntry[]> } | null = null;
const listeners = new Set<() => void>();

function rosterFor(uid: string): Promise<RosterEntry[]> {
  if (cached === null || cached.uid !== uid) {
    // listRoster answers [] on a database error; the catch is for the network
    // itself going away. Either way an empty list, never a thrown promise that
    // the cache would then hand to every caller.
    cached = { uid, promise: listRoster().catch((): RosterEntry[] => []) };
  }
  return cached.promise;
}

/** Forget the cached roster and have every mounted consumer fetch it again. */
export function invalidateRoster(): void {
  cached = null;
  for (const listener of listeners) listener();
}

/** The signed-in user's roster, or null while it loads (and when signed out). */
export function useRoster(uid: string | null): RosterEntry[] | null {
  // Remembered with the user it was read for, so the derived value is null
  // the moment the account changes — no effect has to clear it.
  const [state, setState] = useState<{ uid: string; roster: RosterEntry[] } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
      // The last consumer leaving drops the cache, so a name added on the
      // roster screen is in the next read-out's list without a restart. One
      // fetch per read-out, not per app session.
      if (listeners.size === 0) cached = null;
    };
  }, []);

  useEffect(() => {
    if (uid === null) return;
    let live = true;
    void rosterFor(uid).then((list) => {
      if (live) setState({ uid, roster: list });
    });
    return () => {
      live = false;
    };
  }, [uid, version]);

  return uid !== null && state !== null && state.uid === uid ? state.roster : null;
}
