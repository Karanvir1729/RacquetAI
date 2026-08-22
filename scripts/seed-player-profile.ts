/**
 * Seed a player profile into a user's roster from local pipeline outputs.
 *
 * Why this exists: a profile is normally built by naming Player A/B on a
 * read-out in the browser, which needs the user's own session. For a
 * plumbing check (or to backfill a roster from matches analysed on the
 * laptop) this does the same writes server-side with the service role key
 * from analysis/.env — the summaries are built by the SAME summarizeClip the
 * browser uses, so what lands in the table is what the UI would have written.
 *
 * Usage (from the repo root; bundle with esbuild because the web modules use
 * extensionless relative imports):
 *
 *   npx esbuild scripts/seed-player-profile.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/seed-player-profile.mjs \
 *   && node /tmp/seed-player-profile.mjs \
 *        --email you@example.com --name "Mohamed ElShorbagy" \
 *        --notes "Test profile — stand-in footage" \
 *        --clip analysis/out/archive_match1:A:2026-05-14:"Club match 1" \
 *        --clip analysis/out/archive_match2_fix:A:2026-06-20:"Club match 2" \
 *        [--replace]   # drop the player's existing clips first (idempotent re-seed)
 *
 * Nothing secret is printed. The service key never leaves this process.
 */
import fs from "node:fs";
import path from "node:path";

import { parseAnalysisValue, type PlayerId } from "../web/src/analysis/types";
import { summarizeClip, isIsoDay } from "../web/src/players/shape";

interface ClipSpec {
  dir: string;
  side: PlayerId;
  playedAt: string;
  title: string;
}

function readEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function parseArgs(argv: string[]) {
  const out = { email: "", name: "", notes: "", hand: null as "right" | "left" | null, replace: false, clips: [] as ClipSpec[] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (arg === "--email") out.email = next();
    else if (arg === "--name") out.name = next();
    else if (arg === "--notes") out.notes = next();
    else if (arg === "--hand") out.hand = next() === "left" ? "left" : "right";
    else if (arg === "--replace") out.replace = true;
    else if (arg === "--clip") {
      const spec = next();
      // dir:side:date:title — the title may itself contain colons, so split 3 times only.
      const parts = spec.split(":");
      const dir = parts[0] ?? "";
      const side = parts[1] ?? "";
      const playedAt = parts[2] ?? "";
      const title = parts.slice(3).join(":");
      if ((side !== "A" && side !== "B") || !isIsoDay(playedAt)) {
        throw new Error(`bad --clip spec: ${spec} (want dir:A|B:YYYY-MM-DD:title)`);
      }
      out.clips.push({ dir, side, playedAt, title });
    }
  }
  if (!out.email || !out.name || out.clips.length === 0) {
    throw new Error("need --email, --name and at least one --clip");
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const env = readEnv(path.join(root, "analysis", ".env"));
  const url = (env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in analysis/.env");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // 1. the user
  const usersRes = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!usersRes.ok) throw new Error(`admin users: HTTP ${usersRes.status}`);
  const usersJson = (await usersRes.json()) as { users?: Array<{ id: string; email?: string; last_sign_in_at?: string }> };
  const matches = (usersJson.users ?? []).filter((u) => (u.email ?? "").toLowerCase() === args.email.toLowerCase());
  if (matches.length === 0) throw new Error(`no auth user with email ${args.email}`);
  matches.sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));
  const user = matches[0]!;
  console.log(`user: ${user.id} (${matches.length} account(s) with that email; using most recently signed in)`);

  // 2. the player (reuse by case-insensitive name — same rule as the unique index)
  const existingRes = await fetch(
    `${url}/rest/v1/players?user_id=eq.${user.id}&name=ilike.${encodeURIComponent(args.name.trim())}&select=id,name`,
    { headers },
  );
  const existing = (await existingRes.json()) as Array<{ id: string; name: string }>;
  let playerId: string;
  if (Array.isArray(existing) && existing.length > 0) {
    playerId = existing[0]!.id;
    await fetch(`${url}/rest/v1/players?id=eq.${playerId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ notes: args.notes || null, hand: args.hand, updated_at: new Date().toISOString() }),
    });
    console.log(`player: reusing ${playerId} (${existing[0]!.name})`);
  } else {
    const createRes = await fetch(`${url}/rest/v1/players`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ user_id: user.id, name: args.name.trim(), notes: args.notes || null, hand: args.hand }),
    });
    const created = (await createRes.json()) as Array<{ id: string }>;
    if (!createRes.ok || !Array.isArray(created) || created.length === 0) {
      throw new Error(`create player: HTTP ${createRes.status} ${JSON.stringify(created).slice(0, 200)}`);
    }
    playerId = created[0]!.id;
    console.log(`player: created ${playerId}`);
  }

  // 3. optionally clear, then 4. the clips
  if (args.replace) {
    const del = await fetch(`${url}/rest/v1/player_clips?player_id=eq.${playerId}`, { method: "DELETE", headers });
    console.log(`cleared existing clips: HTTP ${del.status}`);
  }
  const rows = [];
  for (const spec of args.clips) {
    const file = path.join(root, spec.dir, "analysis.json");
    const analysis = parseAnalysisValue(JSON.parse(fs.readFileSync(file, "utf8")));
    if (analysis === null) throw new Error(`unreadable analysis: ${file}`);
    const summary = summarizeClip(analysis, spec.side);
    if (summary === null) throw new Error(`side ${spec.side} not in ${file}`);
    rows.push({
      user_id: user.id,
      player_id: playerId,
      side: spec.side,
      title: spec.title.slice(0, 200),
      job_id: null,
      history_id: null,
      played_at: spec.playedAt,
      duration_sec: summary.durationSec,
      shots: summary.me.shots,
      summary,
    });
  }
  const insertRes = await fetch(`${url}/rest/v1/player_clips`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  const inserted = (await insertRes.json()) as unknown;
  if (!insertRes.ok) throw new Error(`insert clips: HTTP ${insertRes.status} ${JSON.stringify(inserted).slice(0, 300)}`);
  console.log(`clips: inserted ${Array.isArray(inserted) ? inserted.length : "?"}`);
  console.log(`profile: https://racketiq.tech/players/${playerId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
