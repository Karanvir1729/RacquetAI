import { ArrowLeft, ArrowUpRight, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { PlayerProfileView } from "@/components/players/PlayerProfileView";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { fetchSharedProfile } from "@/players/store";
import type { Player, PlayerClip } from "@/players/shape";

/**
 * A profile its owner chose to share, at /p/:token.
 *
 * No sign-in: the page asks the `shared_player` RPC for whatever sits behind
 * the token and gets either the profile (owner's ids stripped) or null. That
 * null covers every way a link can be dead — never minted, revoked, player
 * deleted — and the page says so without distinguishing, because "this link
 * isn't live" is all a reader needs and all the owner would want said.
 *
 * Same view as the owner's, read-only, under a banner that names what it is
 * and points at the limits page: a shared profile is read as a verdict on a
 * person by someone who did not see the footage, so the honesty copy matters
 * more here, not less. A card's "Show detailed analysis" opens the stored
 * analysis at `/p/:token/clips/:clipId` — the read-out, never the footage.
 */
export default function SharedPlayer() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [loaded, setLoaded] = useState<{ player: Player; clips: PlayerClip[] } | null>(null);

  useDocumentTitle(loaded?.player.name ?? "Shared profile");

  useEffect(() => {
    let live = true;
    setState("loading");
    fetchSharedProfile(token ?? "")
      .then((result) => {
        if (!live) return;
        setLoaded(result);
        setState(result === null ? "missing" : "ready");
      })
      .catch(() => {
        // The store answers null on a database error; this is the network
        // itself going away. "Not live" is the nearest honest state.
        if (!live) return;
        setLoaded(null);
        setState("missing");
      });
    return () => {
      live = false;
    };
  }, [token]);

  if (state === "loading") {
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
          <h2 className="rq-h3">This link isn't live</h2>
          <p className="rq-lead-sm mt-3">The owner may have stopped sharing, or the link is wrong.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink to="/players/sample" size="md">
              See a sample profile
            </ButtonLink>
            <ButtonLink to="/" variant="outline" size="md">
              Back to the overview
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
        basePath={`/p/${token ?? ""}`}
        readOnly
        banner={
          <Card featured className="flex gap-3 p-4 sm:p-5">
            <span className="mt-0.5 shrink-0" style={{ color: "var(--rq-accent-text)" }}>
              <Link2 className="h-4 w-4" />
            </span>
            <p className="rq-lead-sm" style={{ color: "var(--rq-text)" }}>
              Shared by its owner, read-only. The numbers come from footage they tagged; see{" "}
              <Link
                to="/#limits"
                className="font-semibold underline-offset-4 hover:underline"
                style={{ color: "var(--rq-accent-text)" }}
              >
                what this can and cannot measure
              </Link>
              .
            </p>
          </Card>
        }
      />
      <Section compact>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="rq-caption">Built with RacketIQ from footage the owner analysed.</p>
          <ButtonLink to="/players" variant="ghost" size="sm">
            Build your own roster <ArrowUpRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}

/** Header + back link for the states that have no profile to show. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Shared profile</p>
        <h1 className="rq-h2 mt-3">One player, every clip</h1>
        {children}
        <div className="mt-8">
          <ButtonLink to="/" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the overview
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
