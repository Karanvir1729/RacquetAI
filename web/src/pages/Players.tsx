import { ArrowLeft, ArrowUpRight, Film, Plus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { formatIsoDay } from "@/components/players/ContributionGrid";
import { HandSelect } from "@/components/players/PlayerProfileView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { createPlayer, listRoster, type RosterEntry } from "@/players/store";
import { validatePlayerName, type Hand } from "@/players/shape";

/**
 * The roster — everyone this account has named on a read-out.
 *
 * A player here is the person IN the footage, not the signed-in user (that is
 * /profile). Naming Player A or Player B on any read-out tags that clip to a
 * name; this page lists the names and how much footage sits behind each, and
 * each one opens to a profile that pools it all. Rosters are private to the
 * account that built them — a club-wide view is a later, deliberate step.
 *
 * Signed-out visitors get the sign-in card and the sample profile, which is
 * the whole feature shown on public footage.
 */
export default function Players() {
  const { session, loading } = useAuth();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [name, setName] = useState("");
  const [hand, setHand] = useState<Hand | null>(null);
  const [touched, setTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useDocumentTitle("Players");

  const refresh = useCallback(async () => {
    try {
      setRoster(await listRoster());
    } catch {
      /* keep what is on screen; the next visit re-reads */
    }
    setState("ready");
  }, []);

  useEffect(() => {
    if (loading) return;
    if (session === null) {
      setState("ready");
      return;
    }
    let live = true;
    void listRoster()
      .then((entries) => {
        if (!live) return;
        setRoster(entries);
        setState("ready");
      })
      .catch(() => {
        // The store answers [] on a database error; this is the network
        // itself going away. An empty roster beats a page that never loads.
        if (live) setState("ready");
      });
    return () => {
      live = false;
    };
  }, [session, loading]);

  const nameError = touched ? validatePlayerName(name) ?? undefined : undefined;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (validatePlayerName(name) !== null) return;
    setAdding(true);
    setFailure(null);
    const result = await createPlayer(name, hand);
    setAdding(false);
    if ("error" in result) {
      setFailure(result.error);
      return;
    }
    setName("");
    setHand(null);
    setTouched(false);
    await refresh();
  };

  if (!loading && session === null) {
    return (
      <Shell>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">Sign in to keep a roster</h2>
          <p className="rq-lead-sm mt-3">
            Profiles are stored against your account — a name on a read-out, plus that clip's
            numbers — so they follow you to any machine you sign in on. The footage never leaves the
            browser that analysed it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink to="/login?next=/players" size="md">
              Sign in
            </ButtonLink>
            <ButtonLink to="/players/sample" variant="outline" size="md">
              See a sample profile
            </ButtonLink>
          </div>
        </Card>
      </Shell>
    );
  }

  if (state === "loading") {
    return (
      <Shell>
        <p className="rq-lead-sm mt-8">Loading your roster…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="mt-8 p-5 sm:p-6">
        <form onSubmit={(e) => void add(e)} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_auto] sm:items-end">
          <Field
            id="new-player-name"
            label="Add a player"
            placeholder="Their name, as you'd say it"
            value={name}
            maxLength={80}
            autoComplete="off"
            error={nameError}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(name.length > 0)}
          />
          <HandSelect id="new-player-hand" value={hand} onChange={setHand} />
          <Button type="submit" size="sm" className="min-h-[44px]" disabled={adding}>
            <Plus className="h-4 w-4" /> {adding ? "Adding…" : "Add"}
          </Button>
        </form>
        {failure !== null ? (
          <p className="rq-lead-sm mt-4" role="alert" style={{ color: "var(--rq-danger)" }}>
            {failure}
          </p>
        ) : null}
        <p className="rq-caption mt-4">
          You can also add a player from any read-out — name Player A or Player B and the clip is
          tagged to them in the same step. Naming someone twice reuses the one profile.
        </p>
      </Card>

      {roster.length === 0 ? (
        <Card className="mt-6 p-6 sm:p-8">
          <h2 className="rq-h3">Nobody on the roster yet</h2>
          <p className="rq-lead-sm mt-3">
            Open a read-out — the Analyze page, or Your matches — and name Player A or Player B. Every
            clip they are named on adds to their profile: time at the T, where they play from, how
            predictable they are, and what to exploit.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink to="/library" size="md">
              Your matches
            </ButtonLink>
            <ButtonLink to="/players/sample" variant="outline" size="md">
              See a sample profile
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {roster.map((entry) => (
              <li key={entry.id}>
                <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-rq-text">{entry.name}</p>
                    <p className="rq-caption rq-num mt-1">
                      {entry.recordings} {entry.recordings === 1 ? "recording" : "recordings"} ·{" "}
                      {Math.round(entry.totalSec / 60)} min
                      {entry.lastPlayedAt !== null ? ` · last played ${formatIsoDay(entry.lastPlayedAt)}` : ""}
                      {entry.hand !== null ? ` · ${entry.hand === "right" ? "right-handed" : "left-handed"}` : ""}
                    </p>
                  </div>
                  <ButtonLink to={`/players/${entry.id}`} variant="outline" size="sm">
                    Open
                  </ButtonLink>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <ButtonLink to="/players/sample" variant="ghost" size="sm">
              See the sample profile <ArrowUpRight className="h-4 w-4" />
            </ButtonLink>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Players</p>
        <h1 className="rq-h2 mt-3">Everyone you've filmed</h1>
        <p className="rq-lead-sm mt-4">
          Name Player A or Player B on any read-out and that clip joins their profile — every match
          they have been in, pooled: time at the T, where they play from, how predictable they are,
          and what to exploit. Profiles are private to you.
        </p>
        {children}
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink to="/library" variant="ghost" size="sm">
            <Film className="h-4 w-4" /> Your matches
          </ButtonLink>
          <ButtonLink to="/" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the overview
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
