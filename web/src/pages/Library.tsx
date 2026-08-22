import { ArrowLeft, Trash2, Upload, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  clearHistory,
  deleteHistoryEntry,
  listHistory,
  loadHistoryEntry,
  type HistorySummary,
} from "@/analysis/history";
import { formatClock } from "@/analysis/format";
import { PLAYER_IDS, type MatchAnalysis } from "@/analysis/types";
import { CoachFeedbackPanel } from "@/components/analysis/CoachFeedbackPanel";
import { ResultsView } from "@/components/analysis/ResultsView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { isoDay } from "@/players/shape";
import { tagsForHistoryIds, type ClipTag } from "@/players/store";

/**
 * Every match this browser has analysed.
 *
 * The phone's Library tab, as far as a browser can honestly go: the numbers
 * come back, the footage does not (it never left the visitor's machine, and no
 * browser will hold a match video). See analysis/history.ts for what is kept
 * and why.
 *
 * `?match=` opens one entry, so a saved read-out has a link of its own.
 *
 * Signed in, each row also says who was in it — the player tags live in the
 * account, not the browser, so they are the one part of this list that does
 * follow you to another machine.
 */
export default function Library() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<HistorySummary[]>(() => listHistory());
  const [open, setOpen] = useState<{ summary: HistorySummary; analysis: MatchAnalysis } | null>(
    null,
  );
  const [missing, setMissing] = useState(false);
  const [tags, setTags] = useState<Map<string, ClipTag[]>>(() => new Map());

  const openId = params.get("match");
  const userId = session?.user.id ?? null;

  useDocumentTitle(open === null ? "Your matches" : open.summary.title);

  useEffect(() => {
    if (openId === null || openId.length === 0) {
      setOpen(null);
      setMissing(false);
      return;
    }
    const summary = entries.find((entry) => entry.id === openId);
    const analysis = summary === undefined ? null : loadHistoryEntry(openId);
    if (summary === undefined || analysis === null) {
      setOpen(null);
      setMissing(true);
      return;
    }
    setMissing(false);
    setOpen({ summary, analysis });
  }, [openId, entries]);

  // Who is in each saved match. Re-read whenever the list comes back into
  // view (openId → null), because the read-out it came back from is where
  // tags get made. A failed read is an empty map, never a broken list.
  useEffect(() => {
    if (userId === null || openId !== null) {
      setTags(new Map());
      return;
    }
    let live = true;
    tagsForHistoryIds(entries.map((entry) => entry.id))
      .then((found) => {
        if (live) setTags(found);
      })
      .catch(() => {
        if (live) setTags(new Map());
      });
    return () => {
      live = false;
    };
  }, [userId, openId, entries]);

  const remove = useCallback(
    (id: string) => {
      deleteHistoryEntry(id);
      setEntries(listHistory());
      if (openId === id) setParams({}, { replace: true });
    },
    [openId, setParams],
  );

  const removeAll = useCallback(() => {
    clearHistory();
    setEntries(listHistory());
    setParams({}, { replace: true });
  }, [setParams]);

  if (open !== null) {
    return (
      <ResultsView
        analysis={open.analysis}
        videoSrc={null}
        eyebrow={`Saved ${formatSavedAt(open.summary.savedAt)}`}
        title={open.summary.title}
        caption="Saved on this browser. The footage stayed on the machine that uploaded it, so this is the measurements only — analyse the file again to watch it back with the overlay."
        action={{ to: "/library", label: "All matches" }}
        clipRef={{
          jobId: open.summary.jobId,
          historyId: open.summary.id,
          title: open.summary.title,
          playedAt: savedDay(open.summary.savedAt),
        }}
      >
        <CoachFeedbackPanel analysis={open.analysis} />
      </ResultsView>
    );
  }

  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Your matches</p>
        <h1 className="rq-h2 mt-3">Everything you've analysed here</h1>
        <p className="rq-lead-sm mt-4">
          Kept on this browser, not on our servers — so it is private, and it does not follow you to
          another machine.
        </p>

        {missing ? (
          <Card className="mt-8 p-6">
            <h2 className="rq-h3">That match isn't on this browser</h2>
            <p className="rq-lead-sm mt-3">
              History is per-browser and per-machine. If you analysed it somewhere else, it is
              there.
            </p>
          </Card>
        ) : null}

        {entries.length === 0 ? (
          <Card className="mt-8 p-6 sm:p-8">
            <h2 className="rq-h3">Nothing here yet</h2>
            <p className="rq-lead-sm mt-3">
              Analyse a match and the read-out is kept here automatically — no account needed, no
              upload of the footage beyond the analysis itself.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to="/analyze" size="md">
                <Upload className="h-4 w-4" /> Analyze a match
              </ButtonLink>
              <ButtonLink to="/demo" variant="outline" size="md">
                See a finished one
              </ButtonLink>
            </div>
          </Card>
        ) : (
          <>
            <ul className="mt-8 flex flex-col gap-3">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-rq-text">
                        {entry.title}
                      </p>
                      <p className="rq-caption rq-num mt-1">
                        {formatSavedAt(entry.savedAt)} · {formatClock(entry.durationSec)} ·{" "}
                        {entry.rallies} {entry.rallies === 1 ? "rally" : "rallies"} · {entry.shots}{" "}
                        shots
                      </p>
                      <TagLine tags={tags.get(entry.id)} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ButtonLink to={`/library?match=${entry.id}`} variant="outline" size="sm">
                        Open
                      </ButtonLink>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        aria-label={`Delete ${entry.title}`}
                        className="flex h-11 w-11 items-center justify-center rounded-rq-sm border transition-colors"
                        style={{
                          borderColor: "var(--rq-line)",
                          color: "var(--rq-text-dim)",
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/analyze" size="md">
                <Upload className="h-4 w-4" /> Analyze another
              </ButtonLink>
              <ButtonLink to="/players" variant="outline" size="md">
                <UsersRound className="h-4 w-4" /> Players
              </ButtonLink>
              <Button variant="outline" size="md" onClick={removeAll}>
                Delete all
              </Button>
            </div>
          </>
        )}

        <div className="mt-8">
          <ButtonLink to="/" variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the overview
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

/**
 * "Player A: Mohamed ElShorbagy · Player B: —" under a row, only once at least
 * one side has a name; an untagged match says nothing rather than two dashes.
 */
function TagLine({ tags }: { tags: ClipTag[] | undefined }) {
  if (tags === undefined || tags.length === 0) return null;
  return (
    <p className="rq-caption mt-1 flex flex-wrap gap-x-1">
      {PLAYER_IDS.map((side, index) => {
        const tag = tags.find((item) => item.side === side);
        return (
          <span key={side}>
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            Player {side}:{" "}
            {tag === undefined ? (
              "—"
            ) : (
              <Link
                to={`/players/${tag.playerId}`}
                className="font-semibold underline-offset-4 hover:underline"
                style={{ color: "var(--rq-accent-text)" }}
              >
                {tag.playerName.length > 0 ? tag.playerName : "Unnamed player"}
              </Link>
            )}
          </span>
        );
      })}
    </p>
  );
}

/**
 * The day a match was saved, in this browser's own calendar — the default
 * "played on" when one of its players is named. The stamp is UTC, so slicing
 * it would put an evening save on tomorrow's date west of Greenwich.
 */
function savedDay(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso.slice(0, 10) : isoDay(when);
}

/** "19 Aug 2026, 14:32" in the visitor's locale, or the raw stamp if unparseable. */
function formatSavedAt(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  return when.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
