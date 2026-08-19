import { supabase } from "@/lib/supabase";

/**
 * Metrics event stream. Fire-and-forget inserts into `app_events` — RLS lets
 * anyone with the publishable key write a row (own user_id or null), and only
 * the platform server's service role can read them back. A failed insert must
 * never break a user flow, so errors are swallowed after a console warning.
 */
export function trackEvent(event: string, props: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id ?? null;
      const { error } = await supabase
        .from("app_events")
        .insert({ user_id: userId, event, platform: "web", props });
      if (error) console.warn("trackEvent failed:", error.message);
    } catch (err) {
      console.warn("trackEvent failed:", err);
    }
  })();
}
