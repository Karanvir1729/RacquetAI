import { LoaderCircle, LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { readApiBase } from "@/analysis/client";
import { CountBars, DailyBars, StatTile, type DayPoint } from "@/components/admin/charts";
import { Button } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/**
 * Operator metrics, served by the platform server behind basic auth. The
 * credentials live in sessionStorage only — closing the tab signs the
 * operator out. Nothing here touches Supabase directly; the server owns the
 * service-role key and does the aggregation.
 */

interface Metrics {
  generatedAt: string;
  totals: {
    users: number;
    events30d: number;
    purchases: number;
    activeSubscriptions: number;
    revenueCents: number;
  };
  signupsByDay: DayPoint[];
  eventsByDay: DayPoint[];
  eventsByType: Array<{ event: string; count: number }>;
  eventsByPlatform: Array<{ platform: string; count: number }>;
  recentEvents: Array<{ event: string; platform: string; created_at: string }>;
  recentUsers: Array<{ email: string | null; createdAt: string | null; provider: string | null }>;
  purchases: Array<{
    plan: string | null;
    amount_total: number | null;
    status: string | null;
    platform: string | null;
    created_at: string;
  }>;
}

const CREDS_KEY = "racquetiq.adminCreds";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Admin() {
  const [creds, setCreds] = useState<string | null>(() =>
    window.sessionStorage.getItem(CREDS_KEY),
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (basic: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${readApiBase()}/admin/metrics`, {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (response.status === 401) {
        window.sessionStorage.removeItem(CREDS_KEY);
        setCreds(null);
        setError("Wrong username or password.");
        return;
      }
      if (!response.ok) {
        setError(`Metrics server answered HTTP ${response.status}. Is the platform server running?`);
        return;
      }
      setMetrics((await response.json()) as Metrics);
    } catch {
      setError("Could not reach the platform server. Start it locally (analysis/server.py).");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (creds !== null) void load(creds);
  }, [creds, load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    let basic: string;
    try {
      basic = window.btoa(`${username}:${password}`);
    } catch {
      setError("That password contains characters basic auth can't carry.");
      return;
    }
    window.sessionStorage.setItem(CREDS_KEY, basic);
    // Retrying unchanged creds after a network failure is a state no-op, so
    // the creds effect never re-fires — load explicitly in that one case.
    if (basic === creds) void load(basic);
    else setCreds(basic);
  }

  if (creds === null || (metrics === null && error !== null)) {
    return (
      <Section divider={false} className="flex-1">
        <div className="mx-auto max-w-sm">
          <p className="rq-eyebrow text-center">Operators only</p>
          <h1 className="rq-h2 mt-3 text-center">Admin</h1>
          <Card className="mt-8 p-6">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field
                label="Username"
                id="rq-admin-user"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <Field
                label="Password"
                id="rq-admin-pass"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error !== null ? (
                <p className="rq-caption" role="alert" style={{ color: "var(--rq-danger)" }}>
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="md" disabled={busy}>
                {busy ? "Checking…" : "Open dashboard"}
              </Button>
            </form>
          </Card>
        </div>
      </Section>
    );
  }

  if (metrics === null) {
    return (
      <Section divider={false} className="flex-1">
        <div className="flex items-center justify-center gap-3 py-24">
          <LoaderCircle className="h-5 w-5 animate-spin" style={{ color: "var(--rq-text-dim)" }} />
          <span className="rq-lead">Loading metrics…</span>
        </div>
      </Section>
    );
  }

  const { totals } = metrics;

  return (
    <Section divider={false} className="flex-1">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="rq-eyebrow">Operators only</p>
          <h1 className="rq-h2 mt-3">RacquetIQ metrics</h1>
          <p className="rq-caption mt-2" style={{ color: "var(--rq-text-dim)" }}>
            Generated {when(metrics.generatedAt)} · Stripe test mode
          </p>
          {/* A failed refresh leaves the last good figures on screen; say so,
              or the operator reads stale revenue as current. */}
          {error !== null ? (
            <p className="rq-caption mt-1" role="alert" style={{ color: "var(--rq-danger)" }}>
              {error} Showing the figures from the last successful load.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load(creds)}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              window.sessionStorage.removeItem(CREDS_KEY);
              setMetrics(null);
              setCreds(null);
            }}
          >
            <LogOut className="h-4 w-4" /> Lock
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Users" value={String(totals.users)} />
        <StatTile
          label="Active subscriptions"
          value={String(totals.activeSubscriptions)}
          hint={`${totals.purchases} checkout${totals.purchases === 1 ? "" : "s"} recorded`}
        />
        <StatTile label="Revenue (test)" value={money(totals.revenueCents)} />
        <StatTile label="Events — 30 days" value={String(totals.events30d)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="rq-h4">Signups — last 30 days</h2>
          <div className="mt-4">
            <DailyBars points={metrics.signupsByDay} ariaLabel="Signups per day, last 30 days" />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="rq-h4">Events — last 30 days</h2>
          <div className="mt-4">
            <DailyBars points={metrics.eventsByDay} ariaLabel="Events per day, last 30 days" />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="rq-h4">Events by type</h2>
          <div className="mt-4">
            {metrics.eventsByType.length === 0 ? (
              <p className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                Nothing tracked yet.
              </p>
            ) : (
              <CountBars
                rows={metrics.eventsByType.map((row) => ({ label: row.event, count: row.count }))}
              />
            )}
          </div>
          <Hairline className="my-5" />
          <h2 className="rq-h4">By platform</h2>
          <div className="mt-4">
            {metrics.eventsByPlatform.length === 0 ? (
              <p className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                Nothing tracked yet.
              </p>
            ) : (
              <CountBars
                rows={metrics.eventsByPlatform.map((row) => ({
                  label: row.platform,
                  count: row.count,
                }))}
              />
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="rq-h4">Purchases</h2>
          <div className="mt-4 overflow-x-auto">
            {metrics.purchases.length === 0 ? (
              <p className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                No checkouts yet.
              </p>
            ) : (
              // w-full alone lets the columns crush before the overflow-x
              // container ever scrolls — the min-width is what engages it.
              <table className="w-full min-w-[30rem] text-left">
                <thead>
                  <tr className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
                    <th className="pb-2 pr-4 font-semibold">Plan</th>
                    <th className="whitespace-nowrap pb-2 pr-4 font-semibold">Amount</th>
                    <th className="pb-2 pr-4 font-semibold">Status</th>
                    <th className="whitespace-nowrap pb-2 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                  {metrics.purchases.map((row, index) => (
                    <tr key={index} className="border-t" style={{ borderColor: "var(--rq-line)" }}>
                      <td className="py-2 pr-4">{row.plan ?? "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-4">{row.amount_total !== null ? money(row.amount_total) : "—"}</td>
                      <td className="py-2 pr-4">{row.status ?? "—"}</td>
                      <td className="whitespace-nowrap py-2">{when(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="rq-h4">Newest users</h2>
          <div className="mt-4 overflow-x-auto">
            {metrics.recentUsers.length === 0 ? (
              <p className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                No users yet.
              </p>
            ) : (
              <table className="w-full min-w-[26rem] text-left">
                <thead>
                  <tr className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
                    <th className="pb-2 pr-4 font-semibold">Email</th>
                    <th className="pb-2 pr-4 font-semibold">Provider</th>
                    <th className="whitespace-nowrap pb-2 font-semibold">Joined</th>
                  </tr>
                </thead>
                <tbody className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                  {metrics.recentUsers.map((row, index) => (
                    <tr key={index} className="border-t" style={{ borderColor: "var(--rq-line)" }}>
                      <td className="max-w-[14rem] truncate py-2 pr-4">{row.email ?? "—"}</td>
                      <td className="py-2 pr-4">{row.provider ?? "—"}</td>
                      <td className="whitespace-nowrap py-2">{when(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="rq-h4">Latest events</h2>
          <div className="mt-4 overflow-x-auto">
            {metrics.recentEvents.length === 0 ? (
              <p className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                Nothing tracked yet.
              </p>
            ) : (
              <table className="w-full min-w-[26rem] text-left">
                <thead>
                  <tr className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
                    <th className="pb-2 pr-4 font-semibold">Event</th>
                    <th className="pb-2 pr-4 font-semibold">Platform</th>
                    <th className="whitespace-nowrap pb-2 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="rq-caption" style={{ color: "var(--rq-text-dim)" }}>
                  {metrics.recentEvents.slice(0, 12).map((row, index) => (
                    <tr key={index} className="border-t" style={{ borderColor: "var(--rq-line)" }}>
                      <td className="py-2 pr-4">{row.event}</td>
                      <td className="py-2 pr-4">{row.platform}</td>
                      <td className="whitespace-nowrap py-2">{when(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </Section>
  );
}
