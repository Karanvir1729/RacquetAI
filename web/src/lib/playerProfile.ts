/**
 * Persisting the player profile.
 *
 * The shape and its rules live in playerProfileShape.ts; this file is only the
 * I/O. Reads and writes go straight from the browser through Supabase with the
 * user's own token — row-level security does the enforcing, since every policy
 * on the table is `auth.uid() = user_id`. There is no way to address someone
 * else's row and no server hop needed to prove it.
 */
import { supabase } from "@/lib/supabase";

import { fromRow, toRow, type PlayerProfile } from "./playerProfileShape";

export * from "./playerProfileShape";

export async function loadProfile(): Promise<PlayerProfile | null> {
  const { data, error } = await supabase.from("player_profiles").select("*").maybeSingle();
  if (error !== null) return null;
  return fromRow(data);
}

/** Upsert the caller's own row. Returns null on success, else a message. */
export async function saveProfile(p: PlayerProfile): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userId === undefined) return "You are signed out. Sign in and try again.";

  const { error } = await supabase
    .from("player_profiles")
    .upsert({ ...toRow(p, userId), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error === null ? null : error.message;
}
