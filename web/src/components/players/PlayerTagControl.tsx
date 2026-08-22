import { UserRound } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";

import type { MatchAnalysis, PlayerId } from "@/analysis/types";
import { Button } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { useAuth } from "@/lib/auth";
import { isIsoDay, PLAYER_NAME_MAX, validatePlayerName, type ClipRef } from "@/players/shape";
import {
  createPlayer,
  listRoster,
  tagClip,
  tagsForClip,
  untagClip,
  type ClipTag,
  type RosterEntry,
} from "@/players/store";

/**
 * Naming one side of a read-out. This is the small control in a PlayerPanel's
 * header that turns "Player A (lighter shirt)" into a person on the roster —
 * and, once it has, the name becomes a link to everything else that person
 * was ever tagged in.
 *
 * It is deliberately quiet. The panel is about the measurements; this sits
 * beside the heading at caption weight, and only opens into a form when asked.
 * Two of them render on every read-out (one per side), so the roster is
 * fetched once for the page, not once per panel — see the cache below.
 *
 * Signed out it offers a text link to sign in and nothing more: the profile
 * is a convenience laid over the analysis, and nothing here may get in the
 * way of reading the analysis.
 */

// ----------------------------------------------------------------- roster

/**
 * One roster fetch per page. Both panels mount together and would otherwise
 * each ask Supabase for the same list; instead the promise is cached — keyed
 * by user, so an account switch can never read the previous account's names
 * — until a mutation invalidates it. Invalidation also pokes every mounted
 * control into re-fetching, so naming Player A as someone new puts them in
 * Player B's list straight away.
 */
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

/** Forget the cached roster and have every mounted control fetch it again. */
export function invalidateRoster(): void {
  cached = null;
  for (const listener of listeners) listener();
}

function useRoster(uid: string | null): RosterEntry[] | null {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
      // The last control leaving the page drops the cache. It is module-level
      // and the app is a single page, so without this a name added on
      // /players or changed on a profile would be missing from the next
      // read-out's list until a reload. One fetch per read-out, not per visit.
      if (listeners.size === 0) cached = null;
    };
  }, []);

  useEffect(() => {
    if (uid === null) {
      setRoster(null);
      return;
    }
    let live = true;
    void rosterFor(uid).then((list) => {
      if (live) setRoster(list);
    });
    return () => {
      live = false;
    };
  }, [uid, version]);

  return roster;
}

// ---------------------------------------------------------------- control

/** Who to tag: someone already on the roster, or a name typed fresh. */
type Choice = { playerId: string } | { name: string };

export function PlayerTagControl({
  side,
  clipRef,
  analysis,
}: {
  side: PlayerId;
  clipRef: ClipRef;
  analysis: MatchAnalysis;
}) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const uid = session?.user.id ?? null;
  const roster = useRoster(uid);

  const [tag, setTag] = useState<ClipTag | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Callers build the ref inline, so its identity changes every render; the
  // effects key on the two ids that actually name the clip, and the mutations
  // read whatever the latest ref says.
  const { jobId, historyId } = clipRef;
  const latestRef = useRef(clipRef);
  latestRef.current = clipRef;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  // After a save the trigger that opened the popover is gone ("Name this
  // player" becomes "Change"), so focus is handed to its replacement once
  // the tag has re-rendered rather than to a button about to unmount.
  const focusNextRef = useRef(false);
  useEffect(() => {
    // Set on the way in as well as cleared on the way out: StrictMode mounts
    // twice in development, and a flag that only ever goes false would leave
    // every button disabled after the first save.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const label = analysis.players.find((player) => player.id === side)?.label ?? `Player ${side}`;

  useEffect(() => {
    if (!focusNextRef.current) return;
    focusNextRef.current = false;
    triggerRef.current?.focus();
  }, [tag]);

  // The tag this side already carries, if any. A failed read leaves the
  // control in its "untagged" state rather than showing an error — a profile
  // that cannot be reached is not a problem with the analysis.
  useEffect(() => {
    if (uid === null) {
      setTag(null);
      return;
    }
    let live = true;
    void tagsForClip(latestRef.current)
      .then((tags) => {
        if (live) setTag(tags.find((item) => item.side === side) ?? null);
      })
      .catch(() => {
        /* stays untagged; the next interaction re-reads */
      });
    return () => {
      live = false;
    };
  }, [uid, side, jobId, historyId]);

  const refreshTag = useCallback(async () => {
    try {
      const tags = await tagsForClip(latestRef.current);
      if (mountedRef.current) setTag(tags.find((item) => item.side === side) ?? null);
    } catch {
      /* keep what we have */
    }
  }, [side]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setError(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const save = useCallback(
    async (choice: Choice, playedAt: string) => {
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
        const result = await tagClip({
          ref: latestRef.current,
          side,
          analysis,
          playerId,
          playedAt,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        close(false);
        focusNextRef.current = true;
        // Recording counts on the roster moved, and so did this side's tag.
        invalidateRoster();
        await refreshTag();
      } catch {
        setError("Something went wrong. Try again.");
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [analysis, close, refreshTag, side],
  );

  // One-click confirm: the first press only asks; a second within 3 s removes.
  const remove = useCallback(async () => {
    if (tag === null) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const problem = await untagClip(tag.clipId);
      if (problem !== null) {
        setError(problem);
        return;
      }
      setTag(null);
      invalidateRoster();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [confirming, tag]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  // Escape and a click anywhere outside both dismiss. Document-level, not on
  // the dialog: a click on a non-focusable part of the popover leaves focus on
  // <body>, and Escape still has to work from there.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        close(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  // Until the session is known there is nothing true to say; a flash of
  // "Sign in" at a signed-in visitor would be worse than a beat of nothing.
  if (loading) return null;

  if (session === null) {
    // Back to THIS read-out after signing in — Login.tsx honours ?next=, and
    // without it the visitor lands on /account with the panel they meant to
    // name gone.
    return (
      <Link
        to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        className="rq-caption inline-flex min-h-[44px] items-center underline-offset-4 hover:underline"
      >
        Sign in to name players
      </Link>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {tag !== null ? (
        <span className="inline-flex min-h-[44px] flex-wrap items-center gap-x-2 text-[13px]">
          <span aria-hidden="true" style={{ color: "var(--rq-accent-text)" }}>
            ●
          </span>
          <Link
            to={`/players/${tag.playerId}`}
            className="font-semibold underline-offset-4 hover:underline"
            style={{ color: "var(--rq-accent-text)" }}
          >
            {tag.playerName.length > 0 ? tag.playerName : "Unnamed player"}
          </Link>
          <TextButton ref={triggerRef} onClick={() => setOpen((value) => !value)} disabled={busy} expanded={open}>
            Change
          </TextButton>
          <TextButton onClick={() => void remove()} disabled={busy} danger={confirming}>
            {confirming ? "Remove?" : "Remove"}
          </TextButton>
        </span>
      ) : (
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={busy}
        >
          <UserRound className="h-4 w-4" /> Name this player
        </Button>
      )}

      {!open && error !== null ? (
        <p className="rq-caption basis-full" role="alert" style={{ color: "var(--rq-danger)" }}>
          {error}
        </p>
      ) : null}

      {open ? (
        <NamePopover
          label={label}
          roster={roster}
          current={tag}
          defaultPlayedAt={clipRef.playedAt}
          busy={busy}
          error={error}
          onSave={save}
          onClose={() => close(true)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- popover

function NamePopover({
  label,
  roster,
  current,
  defaultPlayedAt,
  busy,
  error,
  onSave,
  onClose,
}: {
  label: string;
  /** Null while loading. */
  roster: RosterEntry[] | null;
  /** Whoever this side is tagged as now, so the list can say so. */
  current: ClipTag | null;
  defaultPlayedAt: string;
  busy: boolean;
  error: string | null;
  onSave: (choice: Choice, playedAt: string) => Promise<void>;
  onClose: () => void;
}) {
  const ids = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [playedAt, setPlayedAt] = useState(isIsoDay(defaultPlayedAt) ? defaultPlayedAt : "");
  const [attempted, setAttempted] = useState(false);
  // Pulled left when the viewport would otherwise cut the right edge off —
  // the two panels sit side by side on a wide screen and stacked on a phone,
  // so "under the button" is not always a place 320px fits.
  const [shiftPx, setShiftPx] = useState(0);

  useLayoutEffect(() => {
    const element = dialogRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const overflow = rect.right - (window.innerWidth - 8);
    if (overflow > 0) setShiftPx(-Math.min(overflow, Math.max(rect.left - 8, 0)));
  }, []);

  // Focus goes to the first thing that can take it — a roster name if there
  // is one, else the name field — and the trigger gets it back on close.
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>("button, input");
    first?.focus();
  }, []);

  const nameProblem = validatePlayerName(name);
  const dateProblem = isIsoDay(playedAt) ? null : "Pick the day this was played.";
  const showNameError = attempted || name.length > 0;

  // The name field doubles as a search over the roster: a long roster is
  // unusable as a plain list, and typing the person's name is what you would
  // do anyway. An exact match on Save reuses the existing player (the store
  // treats a duplicate name as "already have"), so typing instead of tapping
  // cannot fork a profile.
  const needle = name.trim().toLowerCase();
  const matches =
    roster === null
      ? null
      : needle.length === 0
        ? roster
        : roster.filter((player) => player.name.toLowerCase().includes(needle));

  const pick = (playerId: string) => {
    setAttempted(true);
    if (dateProblem !== null) return;
    void onSave({ playerId }, playedAt);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (nameProblem !== null || dateProblem !== null) return;
    void onSave({ name }, playedAt);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Name ${label}`}
      className="absolute top-full z-20 mt-2"
      style={{ left: shiftPx, width: "min(320px, calc(100vw - 2.5rem))" }}
    >
      {/* Opaque panel surface rather than the card's translucent one: this
          floats over the read-out, and a court plan showing through a form
          is noise. */}
      <Card className="p-4" style={{ background: "var(--rq-panel)", boxShadow: "var(--rq-lift-shadow)" }}>
        <p className="rq-label" style={{ color: "var(--rq-text)" }}>
          Who is {label}?
        </p>

        {matches === null ? (
          <p className="rq-caption mt-3">Loading your players…</p>
        ) : matches.length === 0 ? (
          <p className="rq-caption mt-3">
            {roster !== null && roster.length === 0
              ? "No one on your roster yet — add the first name below."
              : "No one on your roster matches — Save adds them."}
          </p>
        ) : (
          <ul className="-mx-1 mt-2 max-h-48 overflow-y-auto" aria-label="Your roster">
            {matches.map((player) => {
              const isCurrent = current !== null && current.playerId === player.id;
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pick(player.id)}
                    aria-current={isCurrent ? "true" : undefined}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-rq-sm px-2 text-left text-[14px] font-semibold transition-colors duration-200 hover:bg-rq-raised focus-visible:bg-rq-raised disabled:opacity-50"
                    style={{ color: "var(--rq-text)" }}
                  >
                    <span className="truncate">
                      {player.name}
                      {isCurrent ? (
                        <span className="rq-caption ml-2" style={{ color: "var(--rq-accent-text)" }}>
                          current
                        </span>
                      ) : null}
                    </span>
                    <span className="rq-caption rq-num shrink-0">
                      {player.recordings} {player.recordings === 1 ? "recording" : "recordings"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="my-4 flex items-center gap-3">
          <Hairline className="flex-1" />
          <span className="rq-caption">or</span>
          <Hairline className="flex-1" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Field
            id={`${ids}-name`}
            label="New player"
            value={name}
            maxLength={PLAYER_NAME_MAX}
            autoComplete="off"
            error={showNameError && nameProblem !== null ? nameProblem : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <Field
            id={`${ids}-date`}
            label="Played on"
            type="date"
            value={playedAt}
            error={dateProblem ?? undefined}
            onChange={(event) => setPlayedAt(event.target.value)}
          />
          {error !== null ? (
            <p className="rq-caption" role="alert" style={{ color: "var(--rq-danger)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ text button

/**
 * The "Change" / "Remove" affordance: a word, not a button-shaped button, so
 * the tagged line reads as a line. Still a 44px target, as everything is.
 */
const TextButton = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    /** "Remove?" — the arming state of the one-click confirm. */
    danger?: boolean;
    expanded?: boolean;
  }
>(function TextButton({ children, onClick, disabled = false, danger = false, expanded }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      className="inline-flex min-h-[44px] items-center text-[12.5px] font-semibold underline-offset-4 transition-colors duration-200 hover:underline disabled:opacity-50"
      style={{ color: danger ? "var(--rq-danger)" : "var(--rq-text-dim)" }}
    >
      {children}
    </button>
  );
});
