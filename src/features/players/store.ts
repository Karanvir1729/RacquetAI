/**
 * Mirrors web/src/players/store.ts — same tables, same rules; only the client
 * differs. If one changes, change both.
 *
 * Player profiles — the I/O. Reads and writes go straight from the phone
 * through Supabase with the user's own token; every policy on `players` and
 * `player_clips` is `auth.uid() = user_id`, so there is no way to address
 * anyone else's roster and no server hop needed to prove it. The domain
 * (shape.ts) and the maths (aggregate.ts) are the ONE shared copy both
 * clients run; this file is the app-side plumbing around them — the app's
 * client (src/lib/supabaseClient) and the app's session (src/lib/auth), which
 * is a synchronous module-scope store rather than a browser hook.
 *
 * Errors come back as messages, never thrown: a profile is a convenience, and
 * nothing here may take down the read-out it decorates.
 *
 * A shared store factory parameterised on the client would be better than a
 * mirror; it is out of scope today and the header line above is the contract
 * until then.
 */
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

import type { MatchAnalysis, PlayerId } from "../analysis/types";
import {
  fromClipRow,
  fromPlayerRow,
  summarizeClip,
  validatePlayerName,
  type ClipRef,
  type Hand,
  type Player,
  type PlayerClip,
} from "./shape";

export interface RosterEntry extends Player {
  recordings: number;
  totalSec: number;
  lastPlayedAt: string | null;
}

export interface ClipTag {
  clipId: string;
  side: PlayerId;
  playerId: string;
  playerName: string;
  playedAt: string;
}

const SIGNED_OUT = "You are signed out. Sign in and try again.";

/** The app keeps the session in memory (auth.ts), so no round trip is needed. */
function userId(): string | null {
  return getSession()?.user.id ?? null;
}

/** PostgREST's unique-violation code, so a duplicate name reads as "already have". */
const UNIQUE_VIOLATION = "23505";

// ----------------------------------------------------------------- players

export async function listRoster(): Promise<RosterEntry[]> {
  const [players, clips] = await Promise.all([
    supabase.from("players").select("*").order("name", { ascending: true }),
    supabase.from("player_clips").select("player_id, played_at, duration_sec"),
  ]);
  if (players.error !== null || !Array.isArray(players.data)) return [];

  const totals = new Map<string, { recordings: number; totalSec: number; last: string | null }>();
  if (clips.error === null && Array.isArray(clips.data)) {
    for (const row of clips.data as Record<string, unknown>[]) {
      const id = typeof row.player_id === "string" ? row.player_id : null;
      if (id === null) continue;
      const entry = totals.get(id) ?? { recordings: 0, totalSec: 0, last: null };
      entry.recordings += 1;
      entry.totalSec += typeof row.duration_sec === "number" ? row.duration_sec : 0;
      const played = typeof row.played_at === "string" ? row.played_at.slice(0, 10) : null;
      if (played !== null && (entry.last === null || played > entry.last)) entry.last = played;
      totals.set(id, entry);
    }
  }

  const roster: RosterEntry[] = [];
  for (const row of players.data) {
    const player = fromPlayerRow(row);
    if (player === null) continue;
    const entry = totals.get(player.id);
    roster.push({
      ...player,
      recordings: entry?.recordings ?? 0,
      totalSec: entry?.totalSec ?? 0,
      lastPlayedAt: entry?.last ?? null,
    });
  }
  return roster;
}

export async function getPlayer(id: string): Promise<Player | null> {
  const { data, error } = await supabase.from("players").select("*").eq("id", id).maybeSingle();
  if (error !== null) return null;
  return fromPlayerRow(data);
}

/**
 * Create a player, or hand back the one that already has this name — naming
 * the same opponent twice must not fork their profile.
 */
export async function createPlayer(
  name: string,
  hand: Hand | null = null,
): Promise<{ player: Player } | { error: string }> {
  const problem = validatePlayerName(name);
  if (problem !== null) return { error: problem };
  const uid = userId();
  if (uid === null) return { error: SIGNED_OUT };
  const trimmed = name.trim();

  const { data, error } = await supabase
    .from("players")
    .insert({ user_id: uid, name: trimmed, hand })
    .select("*")
    .single();
  if (error === null) {
    const player = fromPlayerRow(data);
    return player === null ? { error: "The player was saved but could not be read back." } : { player };
  }
  if (error.code === UNIQUE_VIOLATION) {
    // ilike treats % and _ as wildcards — "Jo_Anne" would also match "Jo Anne"
    // and limit(1) could hand back the wrong profile. Escape them, and order so
    // the answer is the same every time.
    const literal = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: rows } = await supabase
      .from("players")
      .select("*")
      .ilike("name", literal)
      .order("created_at", { ascending: true })
      .limit(1);
    const existing = Array.isArray(rows) && rows.length > 0 ? fromPlayerRow(rows[0]) : null;
    if (existing !== null) return { player: existing };
  }
  return { error: error.message };
}

export async function updatePlayer(
  id: string,
  patch: { name?: string; hand?: Hand | null; notes?: string },
): Promise<string | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const problem = validatePlayerName(patch.name);
    if (problem !== null) return problem;
    row.name = patch.name.trim();
  }
  if (patch.hand !== undefined) row.hand = patch.hand;
  if (patch.notes !== undefined) row.notes = patch.notes.trim() || null;
  const { error } = await supabase.from("players").update(row).eq("id", id);
  if (error === null) return null;
  return error.code === UNIQUE_VIOLATION ? "You already have a player with that name." : error.message;
}

/** Deletes the player and, through the FK cascade, every clip tagged to them. */
export async function deletePlayer(id: string): Promise<string | null> {
  const { error } = await supabase.from("players").delete().eq("id", id);
  return error === null ? null : error.message;
}

// ------------------------------------------------------------------- clips

export async function listClips(playerId: string): Promise<PlayerClip[]> {
  const { data, error } = await supabase
    .from("player_clips")
    .select("*")
    .eq("player_id", playerId)
    .order("played_at", { ascending: true });
  if (error !== null || !Array.isArray(data)) return [];
  const clips: PlayerClip[] = [];
  for (const row of data) {
    const clip = fromClipRow(row);
    if (clip !== null) clips.push(clip);
  }
  return clips;
}

export async function deleteClip(clipId: string): Promise<string | null> {
  const { error } = await supabase.from("player_clips").delete().eq("id", clipId);
  return error === null ? null : error.message;
}

export async function updateClipDate(clipId: string, playedAt: string): Promise<string | null> {
  const { error } = await supabase
    .from("player_clips")
    .update({ played_at: playedAt })
    .eq("id", clipId);
  return error === null ? null : error.message;
}

/** Rows already tagged on this clip, by job id first and library id second. */
async function existingRows(ref: ClipRef): Promise<Record<string, unknown>[]> {
  if (ref.jobId !== null) {
    const { data, error } = await supabase
      .from("player_clips")
      .select("id, side, player_id, played_at, players(name)")
      .eq("job_id", ref.jobId);
    if (error === null && Array.isArray(data) && data.length > 0) {
      return data as Record<string, unknown>[];
    }
  }
  if (ref.historyId !== null) {
    const { data, error } = await supabase
      .from("player_clips")
      .select("id, side, player_id, played_at, players(name)")
      .eq("history_id", ref.historyId);
    if (error === null && Array.isArray(data)) return data as Record<string, unknown>[];
  }
  return [];
}

/** Who, if anyone, each side of this read-out has already been named as. */
export async function tagsForClip(ref: ClipRef): Promise<ClipTag[]> {
  if (ref.jobId === null && ref.historyId === null) return [];
  const rows = await existingRows(ref);
  const tags: ClipTag[] = [];
  for (const row of rows) {
    const side = row.side === "A" || row.side === "B" ? (row.side as PlayerId) : null;
    const joined = row.players as { name?: unknown } | null | undefined;
    const name = joined !== null && joined !== undefined && typeof joined.name === "string" ? joined.name : "";
    if (side === null || typeof row.id !== "string" || typeof row.player_id !== "string") continue;
    tags.push({
      clipId: row.id,
      side,
      playerId: row.player_id,
      playerName: name,
      playedAt: typeof row.played_at === "string" ? row.played_at.slice(0, 10) : ref.playedAt,
    });
  }
  return tags;
}

/**
 * Name one side of a read-out. Re-tagging the same side replaces the earlier
 * tag (whoever it pointed at) rather than stacking a second — a clip has one
 * Player A. The stored summary is recomputed from the analysis passed in, so
 * a re-tag from a newer read of the same file carries the newer numbers.
 */
export async function tagClip(opts: {
  ref: ClipRef;
  side: PlayerId;
  analysis: MatchAnalysis;
  playerId: string;
  playedAt: string;
}): Promise<{ clipId: string } | { error: string }> {
  const uid = userId();
  if (uid === null) return { error: SIGNED_OUT };
  const summary = summarizeClip(opts.analysis, opts.side);
  if (summary === null) return { error: "That side is not in this analysis." };
  if (opts.ref.jobId === null && opts.ref.historyId === null) {
    return { error: "This read-out has no id to tag against." };
  }

  const row = {
    user_id: uid,
    player_id: opts.playerId,
    side: opts.side,
    title: opts.ref.title.slice(0, 200),
    job_id: opts.ref.jobId,
    history_id: opts.ref.historyId,
    played_at: opts.playedAt,
    duration_sec: summary.durationSec,
    shots: summary.me.shots,
    summary,
  };

  const prior = (await existingRows(opts.ref)).find((r) => r.side === opts.side);
  if (prior !== undefined && typeof prior.id === "string") {
    const { error } = await supabase.from("player_clips").update(row).eq("id", prior.id);
    return error === null ? { clipId: prior.id } : { error: error.message };
  }
  const { data, error } = await supabase.from("player_clips").insert(row).select("id").single();
  if (error !== null) return { error: error.message };
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" ? { clipId: id } : { error: "The tag was saved but could not be read back." };
}

export async function untagClip(clipId: string): Promise<string | null> {
  return deleteClip(clipId);
}
