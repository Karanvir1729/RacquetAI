import { Apple } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { signInWithApple, signInWithEmail, signUpWithEmail, useAuth } from "@/lib/auth";
import { trackEvent } from "@/lib/events";

/**
 * The login portal. Apple is the headline path (native parity with the iOS
 * app); email + password is the fallback that works with nothing but Supabase.
 * `?next=` carries the visitor back to wherever sign-in interrupted them.
 */
export default function Login() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/account";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => trackEvent("page_view", { page: "login" }), []);

  if (!loading && session) return <Navigate to={next} replace />;

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const problem =
      mode === "signin"
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password);
    setBusy(false);
    if (problem === "confirm") {
      setNotice("Account created — confirm it from the email we sent, then sign in.");
      setMode("signin");
    } else if (problem) {
      setError(problem);
    } else {
      navigate(next, { replace: true });
    }
  }

  async function submitApple() {
    setError(null);
    const problem = await signInWithApple(next);
    // Success navigates the whole page to Apple; only failures come back here.
    if (problem) setError(problem);
  }

  return (
    <Section divider={false} className="flex-1">
      <div className="mx-auto max-w-md">
        <p className="rq-eyebrow text-center">Your account</p>
        <h1 className="rq-h2 mt-3 text-center">
          {mode === "signin" ? "Sign in to RacquetIQ" : "Create your account"}
        </h1>

        <Card className="mt-8 p-6 sm:p-8">
          <Button size="md" className="w-full" onClick={() => void submitApple()}>
            <Apple className="h-5 w-5" /> Continue with Apple
          </Button>

          <div className="my-6 flex items-center gap-3">
            <Hairline className="flex-1" />
            <span className="rq-caption" style={{ color: "var(--rq-text-faint)" }}>
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

            <Button type="submit" size="md" variant="secondary" disabled={busy}>
              {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
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

        <p className="rq-caption mt-6 text-center" style={{ color: "var(--rq-text-faint)" }}>
          Accounts power subscriptions and sync. Analysing a match still works without one.
        </p>
      </div>
    </Section>
  );
}
