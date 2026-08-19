import { readApiBase } from "@/analysis/client";
import { supabase } from "@/lib/supabase";

/**
 * Billing calls go to the analysis server's platform endpoints (/billing/*),
 * authenticated with the visitor's Supabase access token. The server verifies
 * the token against Supabase and Stripe stays the source of truth for money —
 * the browser only ever names a plan or a checkout session id.
 */

export type Plan = "monthly" | "yearly";

export interface BillingStatus {
  active: boolean;
  plan: Plan | null;
}

export class BillingError extends Error {}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new BillingError("Sign in first.");
  return { Authorization: `Bearer ${token}` };
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${readApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload !== null && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new BillingError(detail);
  }
  return payload;
}

/** Create a Stripe Checkout session and send the browser there. */
export async function startCheckout(plan: Plan): Promise<void> {
  const payload = await post("/billing/checkout", { plan, platform: "web" });
  const url =
    payload !== null && typeof payload === "object" && "url" in payload
      ? (payload as { url: unknown }).url
      : null;
  if (typeof url !== "string") throw new BillingError("Stripe did not return a checkout URL.");
  window.location.assign(url);
}

/** Verify a finished checkout session with the server (which asks Stripe). */
export async function confirmCheckout(
  sessionId: string,
): Promise<{ active: boolean; plan: string | null }> {
  const payload = await post("/billing/confirm", { sessionId });
  const record = payload as { active?: unknown; plan?: unknown };
  return {
    active: record.active === true,
    plan: typeof record.plan === "string" ? record.plan : null,
  };
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const response = await fetch(`${readApiBase()}/billing/status`, {
    headers: await authHeader(),
  });
  if (!response.ok) throw new BillingError(`HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const record = payload as { active?: unknown; plan?: unknown };
  return {
    active: record.active === true,
    plan: record.plan === "monthly" || record.plan === "yearly" ? record.plan : null,
  };
}
