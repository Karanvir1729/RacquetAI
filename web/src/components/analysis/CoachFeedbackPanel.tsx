/**
 * The feedback session: one analysis in, a coach's debrief out.
 *
 * It sits below the read-out because that is the order the conversation
 * happens in — you look at what was measured, then someone tells you what it
 * means. Nothing is requested until the player asks for it: a debrief that
 * generates itself on page load spends tokens on people who came to look at a
 * heatmap.
 */
import { MessageCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { coachAvailable, CoachError, requestFeedback } from "@/coach/client";
import type { MatchAnalysis } from "@/analysis/types";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/lib/auth";

export function CoachFeedbackPanel({ analysis }: { analysis: MatchAnalysis }) {
  const { session } = useAuth();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void coachAvailable().then(setAvailable);
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setFeedback(await requestFeedback(analysis));
    } catch (caught) {
      setError(caught instanceof CoachError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [analysis]);

  // Nothing to offer and nothing to explain — stay out of the way entirely.
  if (available !== true) return null;

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold text-[var(--rq-text)]">
        <span className="mr-1.5 inline-block align-[-2px]" style={{ color: "var(--rq-accent-text)" }}>
          <Sparkles className="h-4 w-4" />
        </span>
        A feedback session
      </h3>

      {feedback === null ? (
        <>
          <p className="mt-1 text-[13px] text-[var(--rq-text-dim)]">
            Have a coach read these measurements and tell you what to work on. It knows what the
            analysis can and cannot see, so it will talk about movement and position rather than
            pretend to know where the ball went.
          </p>
          {session === null ? (
            <div className="mt-4">
              <ButtonLink to="/login" size="sm">Sign in for a debrief</ButtonLink>
            </div>
          ) : (
            <Button className="mt-4" size="sm" onClick={() => void run()} disabled={busy}>
              {busy ? "Reading your match…" : "Get my debrief"}
            </Button>
          )}
        </>
      ) : (
        <>
          <div className="mt-3 whitespace-pre-wrap rounded-xl px-4 py-3.5 text-[14px] leading-relaxed"
               style={{ background: "var(--rq-card-raised)", color: "var(--rq-text)" }}>
            {feedback}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink to="/coach" size="sm">
              <MessageCircle className="h-4 w-4" /> Ask a follow-up
            </ButtonLink>
            <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
              {busy ? "Rereading…" : "Another take"}
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-[var(--rq-text-faint)]">
            Generated from the measurements above. Shot classes are inferred from body pose with no
            ball tracking — treat any shot-level claim as indicative.
          </p>
        </>
      )}

      {error !== null ? (
        <p className="mt-3 text-[13px]" role="alert" style={{ color: "var(--rq-danger)" }}>{error}</p>
      ) : null}
    </Card>
  );
}
