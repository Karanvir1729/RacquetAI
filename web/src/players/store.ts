/**
 * Player profiles — the I/O. Reads and writes go straight from the browser
 * through Supabase with the user's own token; every policy on `players` and
 * `player_clips` is `auth.uid() = user_id`, so there is no way to address
 * anyone else's roster and no server hop needed to prove it (the same shape
 * as lib/playerProfile.ts).
 *
 * Errors come back as messages, never thrown: a profile is a convenience, and
 * nothing here may take down the read-out it decorates.
 */
import type { MatchAnalysis, PlayerId } from "../analysis/types";
import { supabase } from "../lib/supabase";
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

async function userId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
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
    for (const row of clips.data as Array<Record<string, unknown>>) {
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
  const uid = await userId();
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
async function existingRows(ref: ClipRef): Promise<Array<Record<string, unknown>>> {
  if (ref.jobId !== null) {
    const { data, error } = await supabase
      .from("player_clips")
      .select("id, side, player_id, played_at, players(name)")
      .eq("job_id", ref.jobId);
    if (error === null && Array.isArray(data) && data.length > 0) {
      return data as Array<Record<string, unknown>>;
    }
  }
  if (ref.historyId !== null) {
    const { data, error } = await supabase
      .from("player_clips")
      .select("id, side, player_id, played_at, players(name)")
      .eq("history_id", ref.historyId);
    if (error === null && Array.isArray(data)) return data as Array<Record<string, unknown>>;
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
 * Tags across many saved matches at once — the library list's "who is in
 * this one" line. Keyed by library id; entries with no tags are absent.
 */
export async function tagsForHistoryIds(historyIds: readonly string[]): Promise<Map<string, ClipTag[]>> {
  const result = new Map<string, ClipTag[]>();
  const ids = historyIds.filter((id) => id.length > 0);
  if (ids.length === 0) return result;
  const { data, error } = await supabase
    .from("player_clips")
    .select("id, side, player_id, played_at, history_id, players(name)")
    .in("history_id", ids);
  if (error !== null || !Array.isArray(data)) return result;
  for (const row of data as Array<Record<string, unknown>>) {
    const historyId = typeof row.history_id === "string" ? row.history_id : null;
    const side = row.side === "A" || row.side === "B" ? (row.side as PlayerId) : null;
    if (historyId === null || side === null || typeof row.id !== "string" || typeof row.player_id !== "string") {
      continue;
    }
    const joined = row.players as { name?: unknown } | null | undefined;
    const name = joined !== null && joined !== undefined && typeof joined.name === "string" ? joined.name : "";
    const list = result.get(historyId) ?? [];
    list.push({
      clipId: row.id,
      side,
      playerId: row.player_id,
      playerName: name,
      playedAt: typeof row.played_at === "string" ? row.played_at.slice(0, 10) : "",
    });
    result.set(historyId, list);
  }
  return result;
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
  const uid = await userId();
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

// ----------------------------------------------------------------- sharing

/**
 * Share links — the first sharing model, done the safe way round. Nothing is
 * shared until the owner asks; minting writes a token on their own row (the
 * RLS policy is the only guard needed), and /p/<token> reads the profile back
 * through the `shared_player` RPC, the one read path a non-owner has. Revoking
 * is clearing the token: the link goes dead at once, nothing to propagate.
 */

/** 32 hex chars — the column takes 16..64; the UUID's dashes go so the URL reads as one word. */
function mintToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Turn sharing on and hand back the token. Re-enabling returns the token the
 * row already carries rather than rotating it — a second click must not break
 * a link the owner has already sent to someone.
 */
export async function enableShare(playerId: string): Promise<{ token: string } | { error: string }> {
  const current = await getPlayer(playerId);
  if (current === null) return { error: "That player isn't on your roster." };
  if (current.shareToken !== null) return { token: current.shareToken };
  const { data, error } = await supabase
    .from("players")
    .update({ share_token: mintToken() })
    .eq("id", playerId)
    .select("share_token")
    .maybeSingle();
  if (error !== null) return { error: error.message };
  // Read the token back from the row rather than trusting the local value:
  // an update that matched no row (not ours, or gone) returns null here.
  const token = (data as { share_token?: unknown } | null)?.share_token;
  return typeof token === "string" && token.length > 0
    ? { token }
    : { error: "The link could not be saved." };
}

/** Turn sharing off. The old link stops resolving; a later enable mints a new one. */
export async function disableShare(playerId: string): Promise<string | null> {
  const { error } = await supabase.from("players").update({ share_token: null }).eq("id", playerId);
  return error === null ? null : error.message;
}

/**
 * The profile behind a share link, or null when the link isn't live — unknown
 * token, sharing revoked, or the player deleted. Anonymous: this is the read
 * the shared page makes with no session at all. The RPC strips the owner's
 * ids on the way out, and the row narrowing tolerates their absence.
 */
export async function fetchSharedProfile(
  token: string,
): Promise<{ player: Player; clips: PlayerClip[] } | null> {
  // The RPC rejects these lengths itself; skipping the round-trip for a
  // mangled URL keeps "not live" instant.
  if (token.length < 16 || token.length > 64) return null;
  const { data, error } = await supabase.rpc("shared_player", { token });
  if (error !== null || typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const payload = data as { player?: unknown; clips?: unknown };
  const player = fromPlayerRow(payload.player);
  if (player === null) return null;
  const clips: PlayerClip[] = [];
  if (Array.isArray(payload.clips)) {
    for (const row of payload.clips) {
      const clip = fromClipRow(row);
      if (clip !== null) clips.push(clip);
    }
  }
  return { player, clips };
}

/** The link an owner copies — this origin, so a staging build shares staging. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/p/${token}`;
}
