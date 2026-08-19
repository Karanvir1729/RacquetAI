/**
 * Metrics event stream (iOS side). Fire-and-forget inserts into Supabase's
 * `app_events` table — RLS allows inserts with the publishable key, only the
 * platform server reads them back. A failed insert never surfaces to the
 * user; metrics must not be able to break a flow.
 */
import { supabase } from "./supabaseClient";

export function trackEvent(event: string, props: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      await supabase.from("app_events").insert({
        user_id: data.session?.user.id ?? null,
        event,
        platform: "ios",
        props,
      });
    } catch {
      // Best effort only.
    }
  })();
}
