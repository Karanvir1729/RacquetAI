import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section, SectionHead } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth";
import { startCheckout, type Plan } from "@/lib/billing";
import { trackEvent } from "@/lib/events";

/**
 * Pricing mirrors the app's paywall exactly — $9.99/month, $79.99/year,
 * 3 free analyses — because the store listing rule is that every price the
 * product shows must agree everywhere it appears.
 */
const PLANS: Array<{
  plan: Plan;
  name: string;
  price: string;
  cadence: string;
  note: string;
  featured: boolean;
}> = [
  {
    plan: "yearly",
    name: "Annual",
    price: "$79.99",
    cadence: "per year",
    note: "$6.67 a month, billed yearly — save 33%",
    featured: true,
  },
  {
    plan: "monthly",
    name: "Monthly",
    price: "$9.99",
    cadence: "per month",
    note: "Cancel any time",
    featured: false,
  },
];

const INCLUDED = [
  "Unlimited match analyses",
  "Shot placement, coverage heatmap, time at the T",
  "Works in the iOS app and on the web",
];

export default function Upgrade() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const canceled = params.get("canceled") === "1";
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);
  // The failure belongs to one plan's card, so it has to carry which one.
  const [error, setError] = useState<{ plan: Plan; message: string } | null>(null);

  useEffect(() => trackEvent("page_view", { page: "upgrade" }), []);

  async function subscribe(plan: Plan) {
    setBusyPlan(plan);
    setError(null);
    try {
      await startCheckout(plan);
    } catch (err) {
      setError({ plan, message: err instanceof Error ? err.message : "Checkout failed." });
      setBusyPlan(null);
    }
  }

  return (
    <Section divider={false} className="flex-1">
      <SectionHead
        eyebrow="RacketIQ Pro"
        title="Your first 3 analyses are free"
        body="New accounts also start with 3 days of Pro on the house. After that, Pro keeps the analyses coming. Payments run through Stripe — in test mode today, so use card 4242 4242 4242 4242."
        align="center"
      />

      {canceled ? (
        <p className="rq-caption mt-6 text-center" style={{ color: "var(--rq-text-dim)" }}>
          Checkout cancelled — no charge was made.
        </p>
      ) : null}

      <div className="mx-auto mt-10 grid max-w-3xl gap-5 sm:grid-cols-2">
        {PLANS.map((entry) => (
          <Card key={entry.plan} featured={entry.featured} className="flex flex-col p-6 sm:p-8">
            <p className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
              {entry.name}
            </p>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="rq-num text-4xl font-extrabold" style={{ color: "var(--rq-text)" }}>
                {entry.price}
              </span>
              <span className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                {entry.cadence}
              </span>
            </p>
            <p className="rq-caption mt-2" style={{ color: "var(--rq-text-dim)" }}>
              {entry.note}
            </p>

            <ul className="mt-6 flex flex-col gap-2.5">
              {INCLUDED.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: "var(--rq-accent-text)" }}
                  />
                  <span className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                    {line}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              {error !== null && error.plan === entry.plan ? (
                <p className="rq-caption mb-3" role="alert" style={{ color: "var(--rq-danger)" }}>
                  {error.message}
                </p>
              ) : null}
              {loading ? (
                // Auth settles a beat after paint; hold the CTA's geometry and
                // label rather than letting a different button pop in under it.
                <Button
                  size="md"
                  className="w-full"
                  variant={entry.featured ? "primary" : "secondary"}
                  disabled
                >
                  {`Subscribe — ${entry.price} ${entry.cadence}`}
                </Button>
              ) : session ? (
                <Button
                  size="md"
                  className="w-full"
                  variant={entry.featured ? "primary" : "secondary"}
                  disabled={busyPlan !== null}
                  onClick={() => void subscribe(entry.plan)}
                >
                  {busyPlan === entry.plan ? "Opening Stripe…" : `Subscribe — ${entry.price} ${entry.cadence}`}
                </Button>
              ) : (
                <ButtonLink
                  to="/login?next=/upgrade"
                  size="md"
                  className="w-full"
                  variant={entry.featured ? "primary" : "secondary"}
                >
                  Sign in to subscribe
                </ButtonLink>
              )}
            </div>
          </Card>
        ))}
      </div>

      <p className="rq-caption mt-10 text-center" style={{ color: "var(--rq-text-dim)" }}>
        Subscriptions renew until cancelled. In the iOS app, the same account unlocks Pro.
      </p>
    </Section>
  );
}
