import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHead } from "@/components/ui/Section";
import { joinWaitlist } from "@/lib/waitlist";

/**
 * The landing page's closing band: the early-access waitlist. One email field,
 * an optional club, and a promise kept deliberately small. A repeat signup
 * renders the same success state as a first one — the form never says which.
 */
export function WaitlistBand() {
  const [email, setEmail] = useState("");
  const [club, setClub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const problem = await joinWaitlist(email, club);
    setBusy(false);
    if (problem !== null) setError(problem);
    else setJoined(true);
  }

  return (
    <Section id="waitlist" tone="panel">
      <Reveal>
        <SectionHead
          align="center"
          eyebrow="Early access"
          title="Hosted analysis is coming. Get on the list."
          body="Today this site sends your video to an analysis server you point it at. Next comes one that RacquetIQ runs for you — no setup, upload and done. Leave an email, and your club if you play at one, and you'll hear the moment it's your turn."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <Card className="mx-auto mt-10 max-w-xl p-6 sm:p-8">
          {/* The live region wraps the whole card body and is mounted from the
              first render. Announcing the success copy from a node that only
              appears on submit is unreliable — a screen reader has to have been
              watching the region before the content arrives. */}
          <div aria-live="polite">
            {joined ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-9 w-9" style={{ color: "var(--rq-accent-text)" }} />
                <p className="rq-h3 text-[19px]">You&rsquo;re on the list.</p>
                <p className="rq-body max-w-sm text-[15px]" style={{ color: "var(--rq-text-dim)" }}>
                  One email when early access reaches you — that is the whole deal.
                </p>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
                <Field
                  label="Email"
                  id="rq-waitlist-email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Field
                  label="Club (optional)"
                  id="rq-waitlist-club"
                  type="text"
                  autoComplete="organization"
                  maxLength={120}
                  placeholder="Where you play"
                  value={club}
                  onChange={(event) => setClub(event.target.value)}
                />

                {error !== null ? (
                  <p className="rq-caption" style={{ color: "var(--rq-danger)" }} role="alert">
                    {error}
                  </p>
                ) : null}

                <Button type="submit" size="md" disabled={busy}>
                  {busy ? "One moment…" : "Join the waitlist"}
                </Button>

                <p className="rq-caption text-center">
                  No spam and no sharing — one email when early access opens.
                </p>
              </form>
            )}
          </div>
        </Card>
      </Reveal>
    </Section>
  );
}
