import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { formatClock, formatPercent } from "@/analysis/format";
import type { MatchAnalysis } from "@/analysis/types";
import { PlacementGrid } from "@/components/analysis/PlacementGrid";
import { ResultsView } from "@/components/analysis/ResultsView";
import { ShotTypeBars } from "@/components/analysis/ShotTypeBars";
import { formatIsoDay } from "@/components/players/ContributionGrid";
import { shotTypeCounts } from "@/components/players/PlayerProfileView";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Meter, Stat } from "@/components/ui/Stat";
import { SAMPLE_CLIPS, SAMPLE_PLAYER } from "@/data/samplePlayer";
import { useAuth } from "@/lib/auth";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { Player, PlayerClip } from "@/players/shape";
import { fetchClipAnalysis, fetchSharedProfile, getPlayer, listClips, mediaUrl } from "@/players/store";

/**
 * One recording's full read-out, opened from a profile's feed — the same
 * ResultsView the Analyze page and the library render, fed by the analysis
 * STORED against the clip (pose track stripped) rather than by this browser's
 * history, so it opens on any machine that can see the profile.
 *
 * Three doors to one room, told apart by `source`:
 *   /players/:id/clips/:clipId      the owner's roster (sign-in needed)
 *   /players/sample/clips/:clipId   the bundled sample, no sign-in
 *   /p/:token/clips/:clipId         a shared profile, no sign-in
 *
 * What it will not pretend: the footage is not here. Where a poster frame
 * travelled it stands in for the video under a caption that says what it is;
 * where none did, the player says so. A clip tagged before analyses were kept
 * has only its summary, and gets that — the numbers, the placement grid and
 * the shot mix — under a card that says why there is no more.
 */

export type ClipSource = "owned" | "sample" | "shared";

export default function ClipDetail({ source }: { source: ClipSource }) {
  const { id, token, clipId } = useParams<{ id?: string; token?: string; clipId?: string }>();
  if (source === "sample") return <SampleClip clipId={clipId ?? ""} />;
  if (source === "shared") return <SharedClip token={token ?? ""} clipId={clipId ?? ""} />;
  return <OwnedClip id={id ?? ""} clipId={clipId ?? ""} />;
}

// ----------------------------------------------------------------- sources

function SampleClip({ clipId }: { clipId: string }) {
  const clip = SAMPLE_CLIPS.find((item) => item.id === clipId) ?? null;
  if (clip === null) return <MissingClip basePath="/players/sample" playerName={SAMPLE_PLAYER.name} />;
  return <ClipReadout player={SAMPLE_PLAYER} clip={clip} basePath="/players/sample" />;
}

type Loaded = { player: Player; clip: PlayerClip };

function SharedClip({ token, clipId }: { token: string; clipId: string }) {
  const basePath = `/p/${token}`;
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    setState("loading");
    fetchSharedProfile(token)
      .then((result) => {
        if (!live) return;
        const clip = result?.clips.find((item) => item.id === clipId) ?? null;
        if (result === null || clip === null) {
          setLoaded(null);
          setState("missing");
          return;
        }
        setLoaded({ player: result.player, clip });
        setState("ready");
      })
      .catch(() => {
        // The store answers null on a database error; this is the network
        // itself going away. "Not here" is the nearest honest state.
        if (!live) return;
        setLoaded(null);
        setState("missing");
      });
    return () => {
      live = false;
    };
  }, [token, clipId]);

  if (state === "loading") return <Loading />;
  if (state === "missing" || loaded === null) {
    // A dead link and a clip that is not on it read the same from here: the
    // profile page is where "this link isn't live" is said properly.
    return <MissingClip basePath={basePath} playerName={null} />;
  }
  return <ClipReadout player={loaded.player} clip={loaded.clip} basePath={basePath} />;
}

function OwnedClip({ id, clipId }: { id: string; clipId: string }) {
  const { session, loading } = useAuth();
  const basePath = `/players/${id}`;
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (loading || session === null) return;
    if (id.length === 0 || clipId.length === 0) {
      setState("missing");
      return;
    }
    let live = true;
    setState("loading");
    Promise.all([getPlayer(id), listClips(id)])
      .then(([player, clips]) => {
        if (!live) return;
        const clip = clips.find((item) => item.id === clipId) ?? null;
        if (player === null || clip === null) {
          setLoaded(null);
          setState("missing");
          return;
        }
        setLoaded({ player, clip });
        setState("ready");
      })
      .catch(() => {
        if (!live) return;
        setLoaded(null);
        setState("missing");
      });
    return () => {
      live = false;
    };
  }, [id, clipId, session, loading]);

  if (!loading && session === null) {
    const here = `${basePath}/clips/${clipId}`;
    return (
      <Shell eyebrow="Recording" title="The full read-out" back={{ to: basePath, label: "Back to the profile" }}>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">Sign in to see this recording</h2>
          <p className="rq-lead-sm mt-3">
            Player profiles, and the recordings on them, are private to the account that built them.
            Sign in and this one opens.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink to={`/login?next=${encodeURIComponent(here)}`} size="md">
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

  if (loading || state === "loading") return <Loading />;
  if (state === "missing" || loaded === null) return <MissingClip basePath={basePath} playerName={null} />;
  return <ClipReadout player={loaded.player} clip={loaded.clip} basePath={basePath} />;
}

// ----------------------------------------------------------------- read-out

function ClipReadout({ player, clip, basePath }: { player: Player; clip: PlayerClip; basePath: string }) {
  // undefined while the stored analysis is on its way; null when there is
  // none to fetch, or the fetch came back with nothing readable.
  const [analysis, setAnalysis] = useState<MatchAnalysis | null | undefined>(
    clip.analysisPath === null ? null : undefined,
  );
  const title = clip.title.length > 0 ? clip.title : "Match analysis";
  const eyebrow = `${player.name} · ${formatIsoDay(clip.playedAt)}`;
  const back = { to: basePath, label: `Back to ${player.name}` };
  const poster = clip.posterPath !== null ? mediaUrl(clip.posterPath) : null;

  useDocumentTitle(title);

  useEffect(() => {
    const path = clip.analysisPath;
    if (path === null) {
      setAnalysis(null);
      return;
    }
    let live = true;
    setAnalysis(undefined);
    fetchClipAnalysis(path)
      .then((result) => {
        if (live) setAnalysis(result);
      })
      .catch(() => {
        if (live) setAnalysis(null);
      });
    return () => {
      live = false;
    };
  }, [clip.analysisPath]);

  if (analysis === undefined) {
    return (
      <Shell eyebrow={eyebrow} title={title} back={back}>
        <p className="rq-lead-sm mt-8">Loading the stored analysis…</p>
      </Shell>
    );
  }

  if (analysis === null) {
    return (
      <NumbersOnly
        clip={clip}
        eyebrow={eyebrow}
        title={title}
        back={back}
        poster={poster}
        unreadable={clip.analysisPath !== null}
      />
    );
  }

  return (
    <>
      <ResultsView
        analysis={analysis}
        videoSrc={null}
        poster={poster}
        eyebrow={eyebrow}
        title={title}
        caption={
          poster !== null
            ? "The full read-out from the stored analysis. The footage itself stayed on the machine that analysed it — the still above is the one frame that travelled; there is no pose track to draw."
            : "The full read-out from the stored analysis. The footage itself stayed on the machine that analysed it — no still travelled with this one, and there is no pose track to draw."
        }
        action={{ ...back, icon: <ArrowLeft className="h-4 w-4" /> }}
      />
      <Section compact>
        <ButtonLink to={back.to} variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" /> {back.label}
        </ButtonLink>
      </Section>
    </>
  );
}

/**
 * What a clip with no stored analysis can still show: the summary the tag
 * kept. The same figures the profile pools, for this one recording.
 */
function NumbersOnly({
  clip,
  eyebrow,
  title,
  back,
  poster,
  unreadable,
}: {
  clip: PlayerClip;
  eyebrow: string;
  title: string;
  back: { to: string; label: string };
  poster: string | null;
  /** True when a path exists but did not read — a different sentence from "never stored". */
  unreadable: boolean;
}) {
  const { me, opponent } = clip.summary;
  const mix = shotTypeCounts(me.shotTypes);
  const placementTotal = Object.values(me.placement).reduce((sum, count) => sum + count, 0);

  return (
    <Shell eyebrow={eyebrow} title={title} back={back}>
      <Card className="mt-8 overflow-hidden">
        {poster !== null ? (
          <div className="relative" style={{ aspectRatio: "16 / 9", background: "var(--rq-court-floor)" }}>
            <img
              src={poster}
              alt=""
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
            <div className="absolute inset-x-0 bottom-0 p-3" style={{ background: "var(--rq-scrim)" }}>
              <p className="rq-caption text-center" style={{ color: "var(--rq-text)" }}>
                A still from the footage — the video itself stayed on the machine that analysed it.
              </p>
            </div>
          </div>
        ) : null}
        <div className="p-5 sm:p-7">
          <h2 className="rq-h3">No stored analysis for this clip</h2>
          <p className="rq-lead-sm mt-3">
            {unreadable
              ? "The analysis stored for this recording could not be read just now. The summary the tag kept still has its numbers:"
              : "This recording was tagged before analyses were kept with a profile, so only the summary travelled — the numbers below. The footage and the full read-out stayed on the machine that analysed it; open it from that machine's library to see the whole thing."}
          </p>

          <div className="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <div>
              <Stat
                label="T-time"
                value={me.tTimePct.toFixed(1)}
                unit="%"
                hint={
                  opponent !== null
                    ? `Opponent ${opponent.tTimePct.toFixed(0)}%`
                    : "Frames within 1.5 m of the T"
                }
              />
              <Meter value={me.tTimePct / 100} label={`${me.label} T-time`} />
            </div>
            <div>
              <Stat
                label="Predictability"
                value={formatPercent(me.predictability.score)}
                hint="Higher means easier to read"
              />
              <Meter value={me.predictability.score} label={`${me.label} predictability`} />
            </div>
            <Stat label="Shots" value={clip.shots} hint={`as ${me.label}`} reserveTwoLines />
            <Stat
              label="Footage"
              value={formatClock(clip.durationSec)}
              hint={`${clip.summary.rallies.count} ${clip.summary.rallies.count === 1 ? "rally" : "rallies"}`}
              reserveTwoLines
            />
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="rq-micro-label">Where the shots landed</p>
              <p className="rq-caption mt-1.5">
                {placementTotal} shots by the quadrant they were retrieved from — a proxy for where
                they landed.
              </p>
              <div className="mt-4">
                <PlacementGrid placement={me.placement} />
              </div>
            </div>
            <div>
              <p className="rq-micro-label">Shot mix (indicative)</p>
              <p className="rq-caption mt-1.5">
                {me.classifiedShots} shots carrying a class. Read from body pose, unaudited.
              </p>
              <div className="mt-4">
                <ShotTypeBars counts={mix} />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </Shell>
  );
}

// ------------------------------------------------------------------ shells

function Loading() {
  return (
    <Shell eyebrow="Recording" title="The full read-out" back={{ to: "/players", label: "All players" }}>
      <p className="rq-lead-sm mt-8">Loading…</p>
    </Shell>
  );
}

function MissingClip({ basePath, playerName }: { basePath: string; playerName: string | null }) {
  const back = { to: basePath, label: playerName === null ? "Back to the profile" : `Back to ${playerName}` };
  return (
    <Shell eyebrow="Recording" title="The full read-out" back={back}>
      <Card className="mt-8 p-6 sm:p-8">
        <h2 className="rq-h3">That recording isn't here</h2>
        <p className="rq-lead-sm mt-3">
          The link may be stale, the recording may have been removed from the profile, or the
          profile itself is not one this account can see.
        </p>
        <div className="mt-7">
          <ButtonLink to={basePath} size="md">
            {back.label}
          </ButtonLink>
        </div>
      </Card>
    </Shell>
  );
}

/** Header + back link for every state that is not the read-out itself. */
function Shell({
  eyebrow,
  title,
  back,
  children,
}: {
  eyebrow: string;
  title: string;
  back: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">{eyebrow}</p>
        <h1 className="rq-h2 mt-3 break-words">{title}</h1>
        {children}
        <div className="mt-8">
          <ButtonLink to={back.to} variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> {back.label}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
