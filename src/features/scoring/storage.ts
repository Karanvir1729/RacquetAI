/**
 * The match in progress, on disk. A phone backgrounded between games, an
 * accidental swipe out of the app, or a low-memory kill must not cost the
 * players their score — that is the one thing this screen is for.
 *
 * Same sync JSON sidecar pattern as lib/onboarding.ts and lib/analysisQuota.ts:
 * a small versioned file in the documents sandbox, read synchronously so the
 * screen can restore in its state initializer rather than flashing an empty
 * scoreboard, and TOTAL — every read is wrapped, every failure degrades to
 * "no saved match", never a throw on a cold start.
 *
 * Only the event LIST is stored, never the derived score. The score is a fold
 * of the events (squash.ts), so persisting it as well would create a second
 * source of truth that can disagree with the first after an app update.
 *
 * Preferences (mute, autopilot) live in their own file: they outlive any
 * single match, so starting a new one must not silently un-mute the phone or
 * disarm autopilot.
 */
import { File, Paths } from "expo-file-system";

import { DEFAULT_PLAYER_NAMES, PlayerNames } from "./announce";
import { LetRuling, ScoreEvent, ServeBox, Side } from "./types";

const MATCH_FILE_NAME = "referee-match.json";
const PREFS_FILE_NAME = "referee-prefs.json";

/** Long enough for "Mohamed ElShorbagy", short enough to stay on one line. */
export const MAX_PLAYER_NAME_LENGTH = 24;

/** A match in progress: the setup plus every call made so far, in order. */
export interface StoredMatch {
  v: 1;
  /** ISO 8601, for the "started 24 minutes ago" line. */
  startedAt: string;
  names: PlayerNames;
  /** Who served the first rally — the fold needs it, no event carries it. */
  firstServer: Side;
  events: ScoreEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSide(value: unknown): value is Side {
  return value === "A" || value === "B";
}

function isServeBox(value: unknown): value is ServeBox {
  return value === "left" || value === "right";
}

function isRuling(value: unknown): value is LetRuling {
  return value === "let" || value === "stroke" || value === "no-let";
}

/**
 * Trim a name to something safe to draw and to speak. Empty or non-string
 * falls back to the default, so a blank text field can never produce a
 * scoreboard with a nameless player or an announcement with a hole in it.
 */
export function sanitizePlayerName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, MAX_PLAYER_NAME_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseEvent(value: unknown): ScoreEvent | null {
  if (!isRecord(value)) return null;
  const { id, at, kind } = value;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const base = { id, at };
  if (kind === "rally") {
    return isSide(value.winner) ? { ...base, kind: "rally", winner: value.winner } : null;
  }
  if (kind === "let-decision") {
    return isSide(value.appealer) && isRuling(value.ruling)
      ? { ...base, kind: "let-decision", appealer: value.appealer, ruling: value.ruling }
      : null;
  }
  if (kind === "serve-box") {
    return isServeBox(value.box) ? { ...base, kind: "serve-box", box: value.box } : null;
  }
  return null;
}

/**
 * Pure: narrow a persisted match file, or null.
 *
 * ONE bad event rejects the WHOLE file. A partially parsed match folds to a
 * score that looks plausible and is wrong, and this screen reads that score
 * out loud as fact; starting over from 0-0 is obvious and recoverable, a
 * silently wrong score is neither.
 */
export function parseStoredMatch(raw: string): StoredMatch | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1) return null;
  if (typeof data.startedAt !== "string" || data.startedAt.length === 0) return null;
  if (!isSide(data.firstServer)) return null;
  if (!Array.isArray(data.events)) return null;
  if (!isRecord(data.names)) return null;

  const events: ScoreEvent[] = [];
  for (const candidate of data.events) {
    const event = parseEvent(candidate);
    if (event === null) return null;
    events.push(event);
  }

  return {
    v: 1,
    startedAt: data.startedAt,
    names: {
      A: sanitizePlayerName(data.names.A, DEFAULT_PLAYER_NAMES.A),
      B: sanitizePlayerName(data.names.B, DEFAULT_PLAYER_NAMES.B),
    },
    firstServer: data.firstServer,
    events,
  };
}

/** Pure: the exact bytes written for a match. */
export function serializeStoredMatch(match: StoredMatch): string {
  return JSON.stringify(match);
}

/** The match in progress, or null when there isn't one / it can't be read. */
export function readStoredMatch(): StoredMatch | null {
  try {
    const file = new File(Paths.document, MATCH_FILE_NAME);
    if (!file.exists) return null;
    return parseStoredMatch(file.textSync());
  } catch {
    return null;
  }
}

/**
 * Save the match. Called after every call made on court, so it has to be cheap
 * and it has to be silent on failure: a disk error must not interrupt a rally.
 */
export function writeStoredMatch(match: StoredMatch): void {
  try {
    const file = new File(Paths.document, MATCH_FILE_NAME);
    if (!file.exists) file.create();
    file.write(serializeStoredMatch(match));
  } catch {
    // Worst case the match is lost on a kill — never worth a crash mid-match.
  }
}

/**
 * The preferences file, whole. Both flags live in ONE file and are always
 * written together — an earlier version wrote `{v:1, muted}` on every toggle,
 * so adding a second key naively would silently drop the first one every time
 * the other was changed.
 */
export interface RefereePrefs {
  muted: boolean;
  /**
   * Autopilot: the camera scores the rally itself instead of asking.
   *
   * ON for a new install — the app is meant to referee, and a scoreboard that
   * needs a tap after every rally is a scoreboard somebody has to stand next
   * to. It is armed, not hidden: the switch is on the entry screen, the pill
   * is in the courtside row, the countdown is on screen for every rally it
   * scores, and `autopilotDisclosed` guarantees the first-time user is told in
   * words what it is about to do before it does it.
   *
   * NOT on for someone who already has this app. See `readRefereePrefs`.
   */
  autopilot: boolean;
  /**
   * Has this user been shown what autopilot does? False until the disclosure
   * has been through, and persisted so it happens exactly once.
   *
   * It exists because the default is ON: a user who never touched the switch
   * never saw the switch's caption, so the one place the error rate can still
   * reach them is a disclosure before the first watched rally.
   */
  autopilotDisclosed: boolean;
}

/** A fresh install. */
export const DEFAULT_PREFS: RefereePrefs = {
  muted: false,
  autopilot: true,
  autopilotDisclosed: false,
};

/**
 * What an EXISTING user gets for keys their prefs file does not mention.
 *
 * Autopilot shipped off, and a file written by that build has no `autopilot`
 * key at all. Folding such a file onto the new defaults would arm autopilot on
 * somebody who has been using this app for weeks — without a tap, a prompt or
 * a word — and the next mute toggle would persist that inherited `true`,
 * making it indistinguishable from consent forever after. So a file that
 * exists but is silent about autopilot means NO.
 */
const LEGACY_PREFS: RefereePrefs = {
  muted: false,
  autopilot: false,
  autopilotDisclosed: false,
};

/** Pure: narrow the prefs file. Unreadable or unknown-version yields null. */
export function parseRefereePrefs(raw: string): Partial<RefereePrefs> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1) return null;
  const prefs: Partial<RefereePrefs> = {};
  if (typeof data.muted === "boolean") prefs.muted = data.muted;
  if (typeof data.autopilot === "boolean") prefs.autopilot = data.autopilot;
  if (typeof data.autopilotDisclosed === "boolean") {
    prefs.autopilotDisclosed = data.autopilotDisclosed;
  }
  return prefs;
}

/** Pure: narrow the prefs file to the mute flag, or null. */
export function parseMutedPref(raw: string): boolean | null {
  return parseRefereePrefs(raw)?.muted ?? null;
}

/**
 * Every preference, with defaults filled in.
 *
 * Which defaults depends on whether this user is new, and that distinction is
 * the whole point: a MISSING file is a fresh install and gets `DEFAULT_PREFS`
 * (autopilot on); a file that EXISTS is somebody who already had opinions
 * about this screen, and anything it does not mention falls back to
 * `LEGACY_PREFS` (autopilot off) rather than to the new default.
 *
 * A file that cannot be read or parsed is treated as legacy too. Arming
 * autopilot off the back of a filesystem error would be the one bug in this
 * feature with no visible cause.
 */
export function readRefereePrefs(): RefereePrefs {
  try {
    const file = new File(Paths.document, PREFS_FILE_NAME);
    if (!file.exists) return DEFAULT_PREFS;
    return { ...LEGACY_PREFS, ...parseRefereePrefs(file.textSync()) };
  } catch {
    return LEGACY_PREFS;
  }
}

/** Write both flags. Silent on failure: a forgotten preference is a shrug. */
export function writeRefereePrefs(prefs: RefereePrefs): void {
  try {
    const file = new File(Paths.document, PREFS_FILE_NAME);
    if (!file.exists) file.create();
    file.write(
      JSON.stringify({
        v: 1,
        muted: prefs.muted,
        autopilot: prefs.autopilot,
        autopilotDisclosed: prefs.autopilotDisclosed,
      }),
    );
  } catch {
    // A forgotten preference is a shrug; a crash on a toggle is not.
  }
}

/**
 * Are announcements muted? Defaults to FALSE — the whole point of the screen
 * is that it speaks, and a user who is surprised by it has the toggle right
 * there in the header.
 */
export function readAnnouncementsMuted(): boolean {
  return readRefereePrefs().muted;
}

/** Remember the mute choice across matches and launches. */
export function writeAnnouncementsMuted(muted: boolean): void {
  writeRefereePrefs({ ...readRefereePrefs(), muted });
}

/** Is autopilot armed? On for a new install — see `RefereePrefs.autopilot`. */
export function readAutopilot(): boolean {
  return readRefereePrefs().autopilot;
}

export function writeAutopilot(autopilot: boolean): void {
  writeRefereePrefs({ ...readRefereePrefs(), autopilot });
}

/** Has the user been told what autopilot does? */
export function readAutopilotDisclosed(): boolean {
  return readRefereePrefs().autopilotDisclosed;
}

export function writeAutopilotDisclosed(disclosed: boolean): void {
  writeRefereePrefs({ ...readRefereePrefs(), autopilotDisclosed: disclosed });
}
