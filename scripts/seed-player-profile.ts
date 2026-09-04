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
 *        [--media]     # also store each clip's poster + analysis in the profile-media bucket
 *        [--videos analysis/samples/archive_match1.mp4,-]   # one per --clip, in order; "-" = no footage
 *
 * --media does server-side what the browser does at tag time: one JPEG frame
 * per clip (cut with ffmpeg from the local video at a quarter of the way in —
 * the footage itself still goes nowhere) and the analysis with the pose track
 * stripped, both under <user id>/<clip id>/ in the public bucket, then the
 * clip row is pointed at them. A clip with no video gets the analysis only;
 * the profile draws its own poster for it.
 *
 * Nothing secret is printed. The service key never leaves this process.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseAnalysisValue, type MatchAnalysis, type PlayerId } from "../web/src/analysis/types";
import { summarizeClip, isIsoDay, analysisForStorage } from "../web/src/players/shape";

interface ClipSpec {
  dir: string;
  side: PlayerId;
  playedAt: string;
  title: string;
  /** Local video the analysis was run on, when --videos names one. */
  video: string | null;
  /**
   * The analysis-server job this clip came from, when --job-ids names one.
   * With it the read-out can fetch the footage and the pose track back while
   * the job lives, so a seeded clip plays like a freshly tagged one instead of
   * being a poster and a table.
   */
  jobId: string | null;
}

const MEDIA_BUCKET = "profile-media";

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
  const out = {
    email: "",
    name: "",
    notes: "",
    hand: null as "right" | "left" | null,
    replace: false,
    media: false,
    clips: [] as ClipSpec[],
  };
  let videos: string[] | null = null;
  let jobIds: string[] | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (arg === "--email") out.email = next();
    else if (arg === "--name") out.name = next();
    else if (arg === "--notes") out.notes = next();
    else if (arg === "--hand") out.hand = next() === "left" ? "left" : "right";
    else if (arg === "--replace") out.replace = true;
    else if (arg === "--media") out.media = true;
    else if (arg === "--videos") videos = next().split(",").map((v) => v.trim());
    // One per --clip, in order; "-" leaves a clip without a job.
    else if (arg === "--job-ids") jobIds = next().split(",").map((v) => v.trim());
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
      out.clips.push({ dir, side, playedAt, title, video: null, jobId: null });
    }
  }
  if (!out.email || !out.name || out.clips.length === 0) {
    throw new Error("need --email, --name and at least one --clip");
  }
  if (videos !== null) {
    // Aligned with the --clip order; "-" (or empty) means this clip has no footage here.
    if (!out.media) throw new Error("--videos only does something with --media");
    if (videos.length !== out.clips.length) {
      throw new Error(`--videos lists ${videos.length} path(s) for ${out.clips.length} --clip(s)`);
    }
    videos.forEach((video, i) => {
      out.clips[i]!.video = video === "" || video === "-" ? null : video;
    });
  }
  if (jobIds !== null) {
    if (jobIds.length !== out.clips.length) {
      throw new Error(`--job-ids lists ${jobIds.length} id(s) for ${out.clips.length} --clip(s)`);
    }
    jobIds.forEach((jobId, i) => {
      out.clips[i]!.jobId = jobId === "" || jobId === "-" ? null : jobId;
    });
  }
  return out;
}

/** Seconds, from ffprobe; null when it cannot say. */
function probeDurationSec(video: string): number | null {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video],
    { encoding: "utf8" },
  );
  const seconds = Number.parseFloat((probe.stdout ?? "").trim());
  return probe.status === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * One JPEG frame from a quarter of the way into the clip — past the warm-up,
 * the same instant for the same clip on every re-seed. 640 px wide, like the
 * browser's capture. Returns the bytes.
 */
function posterFrame(video: string, durationSec: number): Buffer {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rq-poster-"));
  const out = path.join(tmpDir, "poster.jpg");
  try {
    const result = spawnSync(
      "ffmpeg",
      ["-loglevel", "error", "-y", "-ss", String(Math.max(0, durationSec * 0.25).toFixed(2)), "-i", video,
        "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out],
      { encoding: "utf8" },
    );
    if (result.error) throw new Error(`ffmpeg: ${result.error.message} (is ffmpeg installed?)`);
    if (result.status !== 0 || !fs.existsSync(out)) {
      throw new Error(`ffmpeg exited ${result.status} for ${video}: ${(result.stderr ?? "").trim().slice(0, 200)}`);
    }
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** PUT-like upload to the Storage REST API (upsert), with the service key. */
async function uploadObject(
  url: string,
  key: string,
  objectPath: string,
  body: Uint8Array,
  contentType: string,
  cacheMaxAgeSec: number,
): Promise<void> {
  const res = await fetch(`${url}/storage/v1/object/${MEDIA_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "x-upsert": "true",
      "Content-Type": contentType,
      "Cache-Control": `max-age=${cacheMaxAgeSec}`,
    },
    // A fresh ArrayBuffer-backed view: fetch's body typing will not take a Buffer.
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    throw new Error(`upload ${objectPath}: HTTP ${res.status} ${text}`);
  }
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
    // The rows go, and so do the objects they pointed at — the bucket is
    // otherwise never told a clip is gone. Only storage paths (a "/…" site
    // path is the bundled sample, not ours to remove).
    const oldRes = await fetch(
      `${url}/rest/v1/player_clips?player_id=eq.${playerId}&select=poster_path,analysis_path`,
      { headers },
    );
    const old = (await oldRes.json()) as Array<{ poster_path?: string | null; analysis_path?: string | null }>;
    const objects = (Array.isArray(old) ? old : [])
      .flatMap((row) => [row.poster_path, row.analysis_path])
      .filter((p): p is string => typeof p === "string" && p.length > 0 && !p.startsWith("/"));
    const del = await fetch(`${url}/rest/v1/player_clips?player_id=eq.${playerId}`, { method: "DELETE", headers });
    let mediaNote = "";
    if (objects.length > 0) {
      const rm = await fetch(`${url}/storage/v1/object/${MEDIA_BUCKET}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ prefixes: objects }),
      });
      mediaNote = `, ${objects.length} media object(s): HTTP ${rm.status}`;
    }
    console.log(`cleared existing clips: HTTP ${del.status}${mediaNote}`);
  }
  const rows = [];
  const analyses: MatchAnalysis[] = []; // aligned with rows, for --media
  for (const spec of args.clips) {
    const file = path.join(root, spec.dir, "analysis.json");
    const analysis = parseAnalysisValue(JSON.parse(fs.readFileSync(file, "utf8")));
    if (analysis === null) throw new Error(`unreadable analysis: ${file}`);
    const summary = summarizeClip(analysis, spec.side);
    if (summary === null) throw new Error(`side ${spec.side} not in ${file}`);
    if (spec.video !== null && !fs.existsSync(path.join(root, spec.video))) {
      throw new Error(`no such video: ${spec.video}`);
    }
    analyses.push(analysis);
    rows.push({
      user_id: user.id,
      player_id: playerId,
      side: spec.side,
      title: spec.title.slice(0, 200),
      job_id: spec.jobId,
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

  // 5. optionally the media: a poster frame + the stripped analysis per clip,
  // under the user's own folder, then point the row at them.
  if (args.media) {
    const insertedRows = Array.isArray(inserted) ? (inserted as Array<{ id?: unknown }>) : [];
    if (insertedRows.length !== rows.length) {
      throw new Error(`media: insert returned ${insertedRows.length} row(s) for ${rows.length} clip(s)`);
    }
    for (let i = 0; i < rows.length; i += 1) {
      const clipId = insertedRows[i]!.id;
      if (typeof clipId !== "string") throw new Error("media: inserted row without an id");
      const spec = args.clips[i]!;
      const analysis = analyses[i]!;
      const folder = `${user.id}/${clipId}`;
      const patch: Record<string, string> = {};

      let posterNote = "none";
      if (spec.video !== null) {
        const video = path.join(root, spec.video);
        const durationSec = analysis.video.durationSec > 0 ? analysis.video.durationSec : (probeDurationSec(video) ?? 0);
        const poster = posterFrame(video, durationSec);
        await uploadObject(url, key, `${folder}/poster.jpg`, poster, "image/jpeg", 31536000);
        patch.poster_path = `${folder}/poster.jpg`;
        posterNote = `${poster.length}B`;
      }

      const stored = Buffer.from(JSON.stringify(analysisForStorage(analysis)), "utf8");
      await uploadObject(url, key, `${folder}/analysis.json`, stored, "application/json", 3600);
      patch.analysis_path = `${folder}/analysis.json`;

      const patchRes = await fetch(`${url}/rest/v1/player_clips?id=eq.${clipId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
      if (!patchRes.ok) throw new Error(`point clip ${clipId} at its media: HTTP ${patchRes.status}`);
      console.log(`clip ${clipId}: poster ${posterNote}, analysis ${stored.length}B`);
    }
  }
  console.log(`profile: https://racketiq.tech/players/${playerId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
