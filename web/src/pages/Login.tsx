import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { signInWithEmail, signInWithGoogle, signUpWithEmail, useAuth } from "@/lib/auth";
import { trackEvent } from "@/lib/events";

/**
 * The login portal. Google is the headline path on the web; email + password
 * is the fallback that works with nothing but Supabase. Apple sign-in is
 * deliberately iOS-only (native flow in the app) — no Services ID exists for
 * web, so a button here could only error. `?next=` carries the visitor back
 * to wherever sign-in interrupted them.
 */

/** lucide has no brand mark for Google, so the G ships as a local glyph. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

export default function Login() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/account";

  // The landing page's launch-offer links land here already on the signup
  // face (?mode=signup) — one click fewer between the offer and the account.
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Which path is in flight, not merely whether one is: a single boolean would
  // spin and disable the Google button and the email form together.
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => trackEvent("page_view", { page: "login" }), []);

  if (!loading && session) return <Navigate to={next} replace />;

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setBusy("email");
    setError(null);
    setNotice(null);
    const problem =
      mode === "signin"
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password);
    setBusy(null);
    if (problem === "confirm") {
      setNotice("Account created — confirm it from the email we sent, then sign in.");
      setMode("signin");
    } else if (problem) {
      setError(problem);
    } else {
      navigate(next, { replace: true });
    }
  }

  // Success navigates the whole page to Google; only failures come back here,
  // which is also the only case that has a button left to un-busy.
  async function submitGoogle() {
    setBusy("google");
    setError(null);
    const problem = await signInWithGoogle(next);
    if (problem) {
      setError(problem);
      setBusy(null);
    }
  }

  return (
    <Section divider={false} className="flex-1">
      <div className="mx-auto max-w-md">
        <p className="rq-eyebrow text-center">Your account</p>
        <h1 className="rq-h2 mt-3 text-center">
          {mode === "signin" ? "Sign in to RacketIQ" : "Create your account"}
        </h1>

        <Card className="mt-8 p-6 sm:p-8">
          <Button
            size="md"
            className="w-full"
            disabled={busy !== null}
            onClick={() => void submitGoogle()}
          >
            <GoogleMark className="h-5 w-5" />{" "}
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </Button>

          <div className="my-6 flex items-center gap-3">
            <Hairline className="flex-1" />
            <span className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
              or with email
            </span>
            <Hairline className="flex-1" />
          </div>

          <form className="flex flex-col gap-4" onSubmit={(event) => void submitEmail(event)}>
            <Field
              label="Email"
              id="rq-auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Field
              label="Password"
              id="rq-auth-password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            {error !== null ? (
              <p className="rq-caption" style={{ color: "var(--rq-danger)" }} role="alert">
                {error}
              </p>
            ) : null}
            {notice !== null ? (
              <p className="rq-caption" style={{ color: "var(--rq-text-dim)" }} role="status">
                {notice}
              </p>
            ) : null}

            <Button type="submit" size="md" variant="secondary" disabled={busy !== null}>
              {busy === "email" ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <button
            type="button"
            className="rq-caption mt-5 block min-h-[44px] w-full text-center"
            style={{ color: "var(--rq-text-dim)" }}
            onClick={() => {
              setMode((value) => (value === "signin" ? "signup" : "signin"));
              setError(null);
            }}
          >
            {mode === "signin"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </Card>

        <p className="rq-caption mt-6 text-center" style={{ color: "var(--rq-text-dim)" }}>
          Launch offer: new accounts start with 3 days of RacketIQ Pro, free — no card needed.
          Analysing a match still works without an account.
        </p>
      </div>
    </Section>
  );
}
