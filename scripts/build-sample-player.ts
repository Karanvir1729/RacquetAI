/**
 * Build the sample player profile from real pipeline outputs.
 *
 * Why this exists: the /players page needs something to show a visitor who
 * has tagged nobody yet, and the product's rule is that nothing on screen is
 * invented. So the sample is four REAL archive.org club matches run through
 * the real pipeline (analysis/out/…), reduced by the SAME `summarizeClip` the
 * browser uses when a read-out is tagged — what the sample profile shows is
 * exactly what a profile built by hand from those four read-outs would show.
 *
 * The output is a TypeScript module (web/src/data/samplePlayer.ts) rather
 * than a JSON fetch: four summaries are a few kilobytes, the page wants them
 * on first paint, and a typed constant fails the build if the ClipSummary
 * shape ever moves out from under it.
 *
 * Usage (from the repo root; bundle with esbuild because the web modules use
 * extensionless relative imports):
 *
 *   npx esbuild scripts/build-sample-player.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/build-sample-player.mjs --alias:@=./web/src \
 *   && node /tmp/build-sample-player.mjs
 *
 * Deterministic: same inputs, same file, byte for byte.
 */
import fs from "node:fs";
import path from "node:path";

import { parseAnalysisValue, type PlayerId } from "../web/src/analysis/types";
import { summarizeClip, type ClipSummary, type Player, type PlayerClip } from "../web/src/players/shape";

// Resolved against the working directory, which must be the repo root: the
// bundle this runs as lives in a temp directory, so its own location says
// nothing about where the repo is.
const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "web", "src", "data", "samplePlayer.ts");

/** The four matches, oldest first. Dates are spread over a summer, as a real roster's would be. */
const SOURCES: ReadonlyArray<{ dir: string; side: PlayerId; playedAt: string }> = [
  { dir: "archive_match1", side: "A", playedAt: "2026-06-09" },
  { dir: "archive_match2_fix", side: "A", playedAt: "2026-07-02" },
  { dir: "archive_match3_fix", side: "B", playedAt: "2026-07-23" },
  { dir: "archive_match4_fix", side: "A", playedAt: "2026-08-13" },
];

const SAMPLE_PLAYER: Player = {
  id: "sample",
  name: "Sample player",
  hand: null,
  shareToken: null,
  notes:
    "Built from four archive.org club matches (CC BY-NC 4.0). Name your own players on any read-out to build a real profile.",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function fail(message: string): never {
  console.error(`build-sample-player: ${message}`);
  process.exit(1);
}

function readSummary(dir: string, side: PlayerId): ClipSummary {
  const file = path.join(ROOT, "analysis", "out", dir, "analysis.json");
  if (!fs.existsSync(file)) fail(`missing ${file} — run from the repo root, with the pipeline outputs present`);
  const analysis = parseAnalysisValue(JSON.parse(fs.readFileSync(file, "utf8")));
  if (analysis === null) fail(`${file} does not parse as an analysis`);
  const summary = summarizeClip(analysis, side);
  if (summary === null) fail(`${file} has no side ${side}`);
  return summary;
}

// ------------------------------------------------------------------ emitting

/** 4 dp is plenty for a percentage or a 0..1 map cell, and keeps the file small. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function emitKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/**
 * Prettier-shaped TypeScript for a plain value: double quotes, unquoted keys
 * where the key allows, trailing commas. Arrays of numbers are wrapped
 * `perLine` to a line — a coverage map emitted one number per line is 96
 * lines of nothing; emitted a court row per line it reads like the court.
 */
function emit(value: unknown, indent: string, perLine: number): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(round(value));
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((item) => typeof item === "number")) {
      const lines: string[] = [];
      for (let start = 0; start < value.length; start += perLine) {
        lines.push(
          `${inner}${(value as number[])
            .slice(start, start + perLine)
            .map((n) => String(round(n)))
            .join(", ")},`,
        );
      }
      return `[\n${lines.join("\n")}\n${indent}]`;
    }
    return `[\n${value.map((item) => `${inner}${emit(item, inner, perLine)},`).join("\n")}\n${indent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const cov = value as { rows?: unknown; cols?: unknown };
    // A heatmap wraps its values at its own column count, so each emitted
    // line is one row of the court plan.
    const wrap = typeof cov.cols === "number" && typeof cov.rows === "number" ? cov.cols : perLine;
    return `{\n${entries
      .map(([key, item]) => `${inner}${emitKey(key)}: ${emit(item, inner, wrap)},`)
      .join("\n")}\n${indent}}`;
  }
  fail(`cannot emit a ${typeof value}`);
}

function main(): void {
  const clips: PlayerClip[] = SOURCES.map((source, index) => {
    const summary = readSummary(source.dir, source.side);
    return {
      id: `sample-${index + 1}`,
      playerId: SAMPLE_PLAYER.id,
      side: source.side,
      title: `Club match — archive.org (${index + 1})`,
      jobId: null,
      historyId: null,
      playedAt: source.playedAt,
      durationSec: summary.durationSec,
      shots: summary.me.shots,
      summary,
      createdAt: `${source.playedAt}T12:00:00.000Z`,
    };
  });

  const header = `/**
 * GENERATED by scripts/build-sample-player.ts — do not edit by hand.
 *
 * The sample player profile: four REAL archive.org club matches
 * (CC BY-NC 4.0) from analysis/out/, run through the real pipeline and
 * reduced by the same \`summarizeClip\` the browser uses when a read-out is
 * tagged. Nothing here is invented; the dates are the only fiction (spread
 * over a summer so the calendar and trend have a shape).
 *
 * Sources, oldest first:
${SOURCES.map((s, i) => ` *   sample-${i + 1}: analysis/out/${s.dir}/analysis.json, side ${s.side}, played ${s.playedAt}`).join("\n")}
 *
 * Regenerate (from the repo root):
 *
 *   npx esbuild scripts/build-sample-player.ts --bundle --platform=node --format=esm \\
 *     --outfile=/tmp/build-sample-player.mjs --alias:@=./web/src \\
 *   && node /tmp/build-sample-player.mjs
 */
import type { Player, PlayerClip } from "@/players/shape";

`;

  const body =
    `export const SAMPLE_PLAYER: Player = ${emit(SAMPLE_PLAYER, "", 8)};\n\n` +
    `export const SAMPLE_CLIPS: PlayerClip[] = ${emit(clips, "", 8)};\n`;

  const output = header + body;
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, output, "utf8");
  console.log(
    `wrote ${path.relative(ROOT, OUT_PATH)} — ${clips.length} clips, ${(output.length / 1024).toFixed(1)} KB`,
  );
}

main();
