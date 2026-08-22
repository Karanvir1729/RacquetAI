import { ArrowLeft, Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { listHistory } from "@/analysis/history";
import { PlayerProfileView } from "@/components/players/PlayerProfileView";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { SAMPLE_CLIPS, SAMPLE_PLAYER } from "@/data/samplePlayer";
import { useAuth } from "@/lib/auth";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import {
  deleteClip,
  deletePlayer,
  disableShare,
  enableShare,
  getPlayer,
  listClips,
  updateClipDate,
  updatePlayer,
} from "@/players/store";
import type { Player, PlayerClip } from "@/players/shape";

/**
 * One player's profile, at /players/:id.
 *
 * `/players/sample` is the feature on public footage — a profile assembled
 * from archive.org club matches, no account needed, read-only — so a visitor
 * can see what a profile is before they have filmed anyone. Every other id is
 * a row on the signed-in user's roster: the page loads the player and their
 * clips together, wires the view's edits to the store, and re-reads after
 * each one rather than patching state by hand, so what is on screen is always
 * what the database holds.
 *
 * A card's "Show detailed analysis" opens the library entry when the analysis
 * is in THIS browser's history, else the stored analysis at
 * `/players/:id/clips/:clipId`; the profile itself reads fine from any
 * machine.
 *
 * Sharing is wired the same way as the edits: mint or revoke through the
 * store, then re-read, so the token the view shows is the one the row holds.
 * The sample profile has no share control — it is already public.
 */
export default function PlayerPage() {
  const { id } = useParams<{ id: string }>();
  if (id === "sample") return <SampleProfile />;
  return <OwnedProfile id={id ?? ""} />;
}

function SampleProfile() {
  useDocumentTitle(SAMPLE_PLAYER.name);
  return (
    <>
      <PlayerProfileView
        player={SAMPLE_PLAYER}
        clips={SAMPLE_CLIPS}
        basePath="/players/sample"
        readOnly
        banner={
          <Card featured className="flex gap-3 p-4 sm:p-5">
            <span className="mt-0.5 shrink-0" style={{ color: "var(--rq-accent-text)" }}>
              <Info className="h-4 w-4" />
            </span>
            <p className="rq-lead-sm" style={{ color: "var(--rq-text)" }}>
              A sample profile — not a real person. The numbers are real pipeline output over the
              four recordings listed below.
            </p>
          </Card>
        }
      />
      <BackLinks />
    </>
  );
}

type Loaded = { player: Player; clips: PlayerClip[] };

function OwnedProfile({ id }: { id: string }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // The library is per-browser and synchronous; one read on mount is enough.
  const libraryIds = useMemo(() => new Set(listHistory().map((entry) => entry.id)), []);

  useDocumentTitle(loaded?.player.name ?? "Player");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [player, clips] = await Promise.all([getPlayer(id), listClips(id)]);
      if (player === null) {
        setLoaded(null);
        setState("missing");
        return;
      }
      setLoaded({ player, clips });
      setState("ready");
    } catch {
      // The store answers null/[] on a database error; this is the network
      // itself going away. "Not on your roster" is the nearest honest state
      // the page has, and it beats "Loading…" for ever.
      setLoaded(null);
      setState("missing");
    }
  }, [id]);

  useEffect(() => {
    if (loading || session === null) return;
    if (id.length === 0) {
      setState("missing");
      return;
    }
    void load();
  }, [id, session, loading, load]);

  // Each edit: write, then re-read. The store hands back a message or null
  // and the view shows the message; a failed write changes nothing on screen.
  const afterWrite = useCallback(
    async (message: string | null): Promise<string | null> => {
      if (message === null) await load();
      return message;
    },
    [load],
  );

  if (!loading && session === null) {
    return (
      <Shell>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">Sign in to see this player</h2>
          <p className="rq-lead-sm mt-3">
            Player profiles are private to the account that built them. Sign in and this one opens.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink to={`/login?next=/players/${encodeURIComponent(id)}`} size="md">
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

  if (loading || state === "loading") {
    return (
      <Shell>
        <p className="rq-lead-sm mt-8">Loading…</p>
      </Shell>
    );
  }

  if (state === "missing" || loaded === null) {
    return (
      <Shell>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">That player isn't on your roster</h2>
          <p className="rq-lead-sm mt-3">
            The link may be stale, or the player was deleted. Rosters are private, so a link from
            someone else's account opens nothing here.
          </p>
          <div className="mt-7">
            <ButtonLink to="/players" size="md">
              All players
            </ButtonLink>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <>
      <PlayerProfileView
        player={loaded.player}
        clips={loaded.clips}
        basePath={`/players/${id}`}
        libraryIds={libraryIds}
        onRename={(name) => updatePlayer(id, { name }).then(afterWrite)}
        onHand={(hand) => updatePlayer(id, { hand }).then(afterWrite)}
        onNotes={(notes) => updatePlayer(id, { notes }).then(afterWrite)}
        onDelete={async () => {
          const message = await deletePlayer(id);
          if (message === null) navigate("/players", { replace: true });
          return message;
        }}
        onUntagClip={(clipId) => deleteClip(clipId).then(afterWrite)}
        onClipDate={(clipId, playedAt) => updateClipDate(clipId, playedAt).then(afterWrite)}
        share={{
          token: loaded.player.shareToken,
          onEnable: async () => {
            const result = await enableShare(id);
            return afterWrite("error" in result ? result.error : null);
          },
          onDisable: () => disableShare(id).then(afterWrite),
        }}
      />
      <BackLinks />
    </>
  );
}

/** Header + back link for the states that have no profile to show. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Player profile</p>
        <h1 className="rq-h2 mt-3">One player, every clip</h1>
        {children}
        <div className="mt-8">
          <ButtonLink to="/players" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> All players
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

function BackLinks() {
  return (
    <Section compact>
      <ButtonLink to="/players" variant="ghost" size="sm">
        <ArrowLeft className="h-4 w-4" /> All players
      </ButtonLink>
    </Section>
  );
}
