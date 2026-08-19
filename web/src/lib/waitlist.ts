import { trackEvent } from "@/lib/events";
import { supabase } from "@/lib/supabase";

/**
 * Waitlist signups go straight into the `waitlist` table with the publishable
 * key — RLS allows inserts and nothing else, so the browser can add an email
 * but never read the list back. That also rules out `on conflict` upserts, so
 * a repeat signup surfaces as Postgres unique-violation 23505 and is treated
 * as success: "you're on the list" is true either way, and the form shows the
 * same copy for both cases.
 *
 * Returns a problem string to show the visitor, or null on success — the same
 * convention as the auth helpers.
 */
export async function joinWaitlist(email: string, club: string): Promise<string | null> {
  const { error } = await supabase.from("waitlist").insert({
    // The table checks that emails arrive normalized; do it here.
    email: email.trim().toLowerCase(),
    club: club.trim().length > 0 ? club.trim() : null,
    source: "web-landing",
  });

  if (error !== null && error.code !== "23505") {
    console.warn("joinWaitlist failed:", error.message);
    return "That didn't go through — check the email and try again.";
  }

  trackEvent("waitlist_joined", { repeat: error !== null });
  return null;
}
