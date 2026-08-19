import { BadgeCheck, CreditCard, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, Hairline, IconChip } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { signOut, useAuth } from "@/lib/auth";
import { fetchBillingStatus, type BillingStatus } from "@/lib/billing";
import { trackEvent } from "@/lib/events";

const PLAN_LABEL: Record<string, string> = {
  monthly: "RacquetIQ Pro — $9.99 / month",
  yearly: "RacquetIQ Pro — $79.99 / year",
};

/** Signed-in home: who you are, what you're subscribed to, and the exits. */
export default function Account() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState(false);

  useEffect(() => trackEvent("page_view", { page: "account" }), []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setBillingError(false);
    fetchBillingStatus()
      .then((status) => {
        if (!cancelled) setBilling(status);
      })
      .catch(() => {
        if (!cancelled) setBillingError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading) return null;
  if (!session) return <Navigate to="/login?next=/account" replace />;

  const user = session.user;
  const provider = user.app_metadata.provider ?? "email";
  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <Section divider={false} className="flex-1">
      <div className="mx-auto max-w-2xl">
        <p className="rq-eyebrow">Your account</p>
        <h1 className="rq-h2 mt-3">{user.email ?? "Signed in"}</h1>
        <p className="rq-lead mt-3">
          Signed in with {provider === "apple" ? "Apple" : provider}
          {joined ? ` · member since ${joined}` : ""}.
        </p>

        <Card className="mt-8 p-6 sm:p-8" featured={billing?.active === true}>
          <div className="flex items-start gap-4">
            <IconChip>{billing?.active ? <BadgeCheck className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}</IconChip>
            <div className="flex-1">
              <h2 className="rq-h3">Subscription</h2>
              <p className="rq-lead mt-2 text-[15px]">
                {billing === null && !billingError ? "Checking your plan…" : null}
                {billingError
                  ? "Could not reach the billing server. Start it locally or point the site at one on the Analyze page."
                  : null}
                {billing !== null && billing.active
                  ? PLAN_LABEL[billing.plan ?? ""] ?? "RacquetIQ Pro — active"
                  : null}
                {billing !== null && !billing.active
                  ? "Free — recording, the library, and 3 analyses of your own videos."
                  : null}
              </p>
              {billing !== null && !billing.active ? (
                <ButtonLink to="/upgrade" size="md" className="mt-5">
                  Upgrade to Pro
                </ButtonLink>
              ) : null}
              {billing !== null && billing.active ? (
                <p className="rq-caption mt-4" style={{ color: "var(--rq-text-faint)" }}>
                  Test-mode subscription — manage or cancel it from the Stripe sandbox dashboard.
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        <Hairline className="my-8" />

        <Button
          variant="outline"
          size="md"
          onClick={() => {
            void signOut().then(() => navigate("/", { replace: true }));
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </Section>
  );
}
