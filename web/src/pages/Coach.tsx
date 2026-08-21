import { ArrowLeft, Send, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { listHistory, loadHistoryEntry } from "@/analysis/history";
import { askCoach, coachAvailable, CoachError, type CoachTurn } from "@/coach/client";
import type { MatchAnalysis } from "@/analysis/types";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const STORAGE_KEY = "racketiq.coach.thread.v1";

/** Openers that are actually answerable from what the analysis measures. */
const PROMPTS = [
  "What should I work on first?",
  "Was I moving well between rallies?",
  "How do I stop getting stuck at the back?",
  "Give me a drill for this week.",
];

/**
 * The coach, as a conversation.
 *
 * The thread lives in localStorage, like the match library: it is the
 * visitor's, it survives a refresh, and it never needs a round trip to read.
 * The most recent analysed match rides along with every turn so the coach can
 * be specific rather than generic — see coach/client.ts for why the analysis
 * travels with the request instead of living on the server.
 */
export default function Coach() {
  const { session, loading } = useAuth();
  const [turns, setTurns] = useState<CoachTurn[]>(() => restore());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
  const [matchName, setMatchName] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useDocumentTitle("Your coach");

  useEffect(() => {
    void coachAvailable().then(setAvailable);
  }, []);

  // The newest saved match becomes the conversation's subject.
  useEffect(() => {
    const entries = listHistory();
    const newest = entries[0];
    if (newest === undefined) return;
    const loaded = loadHistoryEntry(newest.id);
    if (loaded !== null) {
      setAnalysis(loaded);
      setMatchName(newest.title);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-40)));
    } catch {
      /* a full or blocked storage must never stop the conversation */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (message.length === 0 || busy) return;
      setError(null);
      setDraft("");
      const history = turns;
      setTurns((t) => [...t, { role: "user", content: message }]);
      setBusy(true);
      try {
        const reply = await askCoach(message, history, analysis);
        setTurns((t) => [...t, { role: "assistant", content: reply }]);
      } catch (caught) {
        setError(caught instanceof CoachError ? caught.message : "Something went wrong.");
        // Put the question back so it is not lost to a failed round trip.
        setTurns((t) => t.slice(0, -1));
        setDraft(message);
      } finally {
        setBusy(false);
      }
    },
    [turns, analysis, busy],
  );

  if (!loading && session === null) return <SignedOut />;

  if (available === false) {
    return (
      <Shell matchName={null}>
        <Card className="mt-8 p-6 sm:p-8">
          <h2 className="rq-h3">No coach on this server</h2>
          <p className="rq-lead-sm mt-3">
            The analysis server this site is pointed at has no language model configured, so there is
            nothing to talk to. The measurements and the referee work regardless.
          </p>
          <div className="mt-7">
            <ButtonLink to="/analyze" size="md">Analyze a match instead</ButtonLink>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell matchName={matchName}>
      <Card className="mt-6 flex flex-col p-0">
        <div className="flex-1 overflow-y-auto px-5 py-5" style={{ maxHeight: "56vh", minHeight: "34vh" }}>
          {turns.length === 0 ? (
            <div className="py-6 text-center">
              <p className="rq-lead-sm">
                {analysis === null
                  ? "Ask anything about your squash. Analyse a match first and the answers get specific."
                  : "Ask anything — the coach has your latest match in front of it."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void send(p)}
                    className="min-h-[38px] rounded-full border px-3.5 text-[13px] transition-colors"
                    style={{ borderColor: "var(--rq-line-2)", color: "var(--rq-text-dim)" }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {turns.map((turn, i) => (
                <li key={i} className={turn.role === "user" ? "flex justify-end" : "flex gap-3"}>
                  {turn.role === "assistant" ? (
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                      style={{ background: "var(--rq-chip)", color: "var(--rq-accent-text)" }}
                      aria-hidden="true"
                    >
                      IQ
                    </span>
                  ) : null}
                  <div
                    className="max-w-[80%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed"
                    style={
                      turn.role === "user"
                        ? { background: "var(--rq-chip)", color: "var(--rq-text)" }
                        : { background: "var(--rq-card-raised)", color: "var(--rq-text)" }
                    }
                  >
                    {turn.content}
                  </div>
                  {turn.role === "user" ? (
                    <span className="sr-only"><User className="h-4 w-4" /> you</span>
                  ) : null}
                </li>
              ))}
              {busy ? (
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                        style={{ background: "var(--rq-chip)", color: "var(--rq-accent-text)" }} aria-hidden="true">IQ</span>
                  <div className="rounded-xl px-3.5 py-2.5 text-[14px]"
                       style={{ background: "var(--rq-card-raised)", color: "var(--rq-text-dim)" }} role="status">
                    Thinking…
                  </div>
                </li>
              ) : null}
            </ul>
          )}
          <div ref={endRef} />
        </div>

        {error !== null ? (
          <p className="px-5 pb-3 text-[13px]" role="alert" style={{ color: "var(--rq-danger)" }}>
            {error}
          </p>
        ) : null}

        <form
          className="flex items-end gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--rq-line)" }}
          onSubmit={(e) => { e.preventDefault(); void send(draft); }}
        >
          <label htmlFor="coach-input" className="sr-only">Ask the coach</label>
          <textarea
            id="coach-input"
            rows={1}
            value={draft}
            disabled={busy}
            placeholder="Ask your coach…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); }
            }}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-rq-sm border px-3 py-2.5 text-[15px]"
            style={{ borderColor: "var(--rq-line-2)", background: "var(--rq-input)", color: "var(--rq-text)" }}
          />
          <Button type="submit" size="md" disabled={busy || draft.trim().length === 0}>
            <Send className="h-4 w-4" /> Send
          </Button>
        </form>
      </Card>

      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink to="/profile" variant="outline" size="sm">Edit your profile</ButtonLink>
        {turns.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => { setTurns([]); setError(null); }}>
            <Trash2 className="h-4 w-4" /> Clear conversation
          </Button>
        ) : null}
      </div>
    </Shell>
  );
}

function restore(): CoachTurn[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is CoachTurn =>
        typeof t === "object" && t !== null &&
        ((t as CoachTurn).role === "user" || (t as CoachTurn).role === "assistant") &&
        typeof (t as CoachTurn).content === "string",
    );
  } catch {
    return [];
  }
}

function SignedOut() {
  return (
    <Shell matchName={null}>
      <Card className="mt-8 p-6 sm:p-8">
        <h2 className="rq-h3">Sign in to talk to your coach</h2>
        <p className="rq-lead-sm mt-3">
          Coaching runs against your account so it can read your profile and so the usage is yours,
          not everyone's.
        </p>
        <div className="mt-7"><ButtonLink to="/login" size="md">Sign in</ButtonLink></div>
      </Card>
    </Shell>
  );
}

function Shell({ children, matchName }: { children: React.ReactNode; matchName: string | null }) {
  return (
    <Section divider={false}>
      <div className="mx-auto max-w-3xl">
        <p className="rq-eyebrow">Your coach</p>
        <h1 className="rq-h2 mt-3">Ask about your game</h1>
        <p className="rq-lead-sm mt-4">
          {matchName === null
            ? "It knows what RacketIQ can and cannot measure, and it will tell you when a question is beyond the footage."
            : `Reading ${matchName} alongside your profile. It will say so when a question is beyond what the footage can show.`}
        </p>
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
