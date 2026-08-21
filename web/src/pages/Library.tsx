import { ArrowLeft, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  clearHistory,
  deleteHistoryEntry,
  listHistory,
  loadHistoryEntry,
  type HistorySummary,
} from "@/analysis/history";
import { formatClock } from "@/analysis/format";
import type { MatchAnalysis } from "@/analysis/types";
import { CoachFeedbackPanel } from "@/components/analysis/CoachFeedbackPanel";
import { ResultsView } from "@/components/analysis/ResultsView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/**
 * Every match this browser has analysed.
 *
 * The phone's Library tab, as far as a browser can honestly go: the numbers
 * come back, the footage does not (it never left the visitor's machine, and no
 * browser will hold a match video). See analysis/history.ts for what is kept
 * and why.
 *
 * `?match=` opens one entry, so a saved read-out has a link of its own.
 */
export default function Library() {
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<HistorySummary[]>(() => listHistory());
  const [open, setOpen] = useState<{ summary: HistorySummary; analysis: MatchAnalysis } | null>(
    null,
  );
  const [missing, setMissing] = useState(false);

  const openId = params.get("match");

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
