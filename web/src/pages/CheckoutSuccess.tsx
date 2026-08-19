import { BadgeCheck, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ButtonLink } from "@/components/ui/Button";
import { Card, IconChip } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth";
import { confirmCheckout } from "@/lib/billing";
import { trackEvent } from "@/lib/events";

type Phase =
  | { kind: "confirming" }
  | { kind: "done"; plan: string | null }
  | { kind: "failed"; reason: string };

/**
 * Stripe's success redirect lands here with ?session_id=. The server re-checks
 * that session against Stripe before recording anything, so this page is just
 * the messenger — it cannot mint a subscription on its own.
 */
export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const { session, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "confirming" });
  const sessionId = params.get("session_id");
  // The platform server's /billing/success redirect already verified the
  // session against Stripe and recorded it when recorded=1 — a signed-out
  // browser (the iOS-pays-in-Safari path) still deserves the good news.
  const recordedByServer = params.get("recorded") === "1";

  useEffect(() => trackEvent("page_view", { page: "checkout_success" }), []);

  useEffect(() => {
    if (loading) return;
    if (sessionId === null || sessionId.length === 0) {
      setPhase({ kind: "failed", reason: "No checkout session in the URL." });
      return;
    }
    if (!session) {
      if (recordedByServer) {
        setPhase({ kind: "done", plan: null });
      } else {
        setPhase({ kind: "failed", reason: "Sign in to finish confirming your purchase." });
      }
      return;
    }
    let cancelled = false;
    confirmCheckout(sessionId)
      .then((result) => {
        if (cancelled) return;
        if (result.active) setPhase({ kind: "done", plan: result.plan });
        else setPhase({ kind: "failed", reason: "Stripe reports this checkout as unpaid." });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setPhase({
            kind: "failed",
            reason: err instanceof Error ? err.message : "Could not confirm the purchase.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [loading, session, sessionId, recordedByServer]);

  return (
    <Section divider={false} className="flex-1">
      <div className="mx-auto max-w-md">
        <Card className="p-6 text-center sm:p-8">
          <div className="flex justify-center">
            <IconChip tone={phase.kind === "failed" ? "danger" : "accent"}>
              {phase.kind === "confirming" ? (
                <LoaderCircle className="h-5 w-5 animate-spin" />
              ) : phase.kind === "done" ? (
                <BadgeCheck className="h-5 w-5" />
              ) : (
                <CircleAlert className="h-5 w-5" />
              )}
            </IconChip>
          </div>

          {/* The outcome arrives after a round-trip to the server, so announce
              it rather than leaving a screen reader on the spinner's copy. */}
          <div aria-live="polite">
            <h1 className="rq-h3 mt-5">
              {phase.kind === "confirming"
                ? "Confirming with Stripe…"
                : phase.kind === "done"
                  ? "You're on RacquetIQ Pro"
                  : "Purchase not confirmed"}
            </h1>

            <p className="rq-lead mt-3 text-[15px]">
              {phase.kind === "confirming" ? "One moment — verifying the checkout session." : null}
              {phase.kind === "done" && phase.plan !== null
                ? `${phase.plan === "yearly" ? "Annual" : "Monthly"} plan active. Every analysis is now unlimited, here and in the iOS app.`
                : null}
              {phase.kind === "done" && phase.plan === null
                ? "Payment confirmed and your subscription is recorded. Sign in on any device to see it."
                : null}
              {phase.kind === "failed" ? (
                <span style={{ color: "var(--rq-danger)" }}>{phase.reason}</span>
              ) : null}
            </p>
          </div>

          <div className="mt-7 flex flex-col gap-3">
            {phase.kind === "done" ? (
              <>
                <ButtonLink to="/analyze" size="md">
                  Analyze a match
                </ButtonLink>
                <ButtonLink to="/account" size="md" variant="outline">
                  Back to your account
                </ButtonLink>
              </>
            ) : null}
            {phase.kind === "failed" && !session && sessionId ? (
              <ButtonLink
                to={`/login?next=${encodeURIComponent(`/checkout/success?session_id=${sessionId}`)}`}
                size="md"
              >
                Sign in to finish
              </ButtonLink>
            ) : null}
            {phase.kind === "failed" ? (
              <ButtonLink to="/upgrade" size="md" variant="outline">
                Back to plans
              </ButtonLink>
            ) : null}
          </div>
        </Card>
      </div>
    </Section>
  );
}
