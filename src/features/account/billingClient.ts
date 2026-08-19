/**
 * HTTP client for the platform server's /billing/status endpoint,
 * authenticated with the Supabase access token. Read-only on purpose: iOS
 * purchases go through the App Store (the paywall route / RevenueCat), so
 * the only billing fact this app needs from the server is whether the
 * account already carries a subscription — e.g. one bought on the web.
 *
 * The base URL is the analysis server's — billing lives on the same Flask
 * process (analysis/server.py mounts analysis/platform_api.py). Importing the
 * analysis feature's serverConfig is a deliberate rule-2 exception with a
 * reason: the platform HAS one server, and duplicating the persisted-URL
 * loader here would let the two copies drift apart.
 */
import { loadServerBaseUrl } from "@/features/analysis/serverConfig";
import { supabase } from "@/lib/supabaseClient";

export type Plan = "monthly" | "yearly";

export interface BillingStatus {
  active: boolean;
  plan: Plan | null;
}

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Subscription state for the signed-in user, or null when unreachable. */
export async function fetchBillingStatus(): Promise<BillingStatus | null> {
  const token = await accessToken();
  if (token === null) return null;
  try {
    const response = await fetch(`${loadServerBaseUrl()}/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const record = (payload ?? {}) as Record<string, unknown>;
    return {
      active: record.active === true,
      plan: record.plan === "monthly" || record.plan === "yearly" ? record.plan : null,
    };
  } catch {
    return null;
  }
}
