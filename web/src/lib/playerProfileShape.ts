/**
 * What a player profile *is*, and what counts as a valid one.
 *
 * Deliberately import-free. Persistence lives next door in playerProfile.ts;
 * this file is the domain — the shape, the vocabulary, the bounds — so the
 * rules can be tested without a database and reused anywhere. Same split the
 * scoring engine uses: `announce.ts` decides the words, something else says
 * them out loud.
 */

export const LEVELS = ["beginner", "improver", "club", "county", "national"] as const;
export type Level = (typeof LEVELS)[number];

export const HANDS = ["right", "left"] as const;
export type Hand = (typeof HANDS)[number];

/** How each level is described to a player, who does not think in enum values. */
export const LEVEL_LABELS: Record<Level, string> = {
  beginner: "Beginner — still learning the shots",
  improver: "Improver — rallying, working on consistency",
  club: "Club — play league or box regularly",
  county: "County — competitive, coached",
  national: "National — national-level competition",
};

export interface PlayerProfile {
  displayName: string;
  level: Level | null;
  yearsPlaying: number | null;
  dominantHand: Hand | null;
  heightCm: number | null;
  goals: string;
  injuries: string;
  playsPerWeek: number | null;
}

export const EMPTY_PROFILE: PlayerProfile = {
  displayName: "",
  level: null,
  yearsPlaying: null,
  dominantHand: null,
  heightCm: null,
  goals: "",
  injuries: "",
  playsPerWeek: null,
};

/** True when there is enough here for the coach to say something specific. */
export function isUsable(p: PlayerProfile): boolean {
  return p.level !== null || p.goals.trim().length > 0;
}

function asLevel(v: unknown): Level | null {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v) ? (v as Level) : null;
}
function asHand(v: unknown): Hand | null {
  return typeof v === "string" && (HANDS as readonly string[]).includes(v) ? (v as Hand) : null;
}
function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}
function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * A database row, narrowed. Anything missing or the wrong type reads as absent
 * rather than throwing — a profile is a convenience, and a malformed row must
 * never be able to take down the page that reads it.
 */
export function fromRow(row: unknown): PlayerProfile {
  if (typeof row !== "object" || row === null) return EMPTY_PROFILE;
  const r = row as Record<string, unknown>;
  return {
    displayName: asText(r.display_name),
    level: asLevel(r.level),
    yearsPlaying: asInt(r.years_playing),
    dominantHand: asHand(r.dominant_hand),
    heightCm: asInt(r.height_cm),
    goals: asText(r.goals),
    injuries: asText(r.injuries),
    playsPerWeek: asInt(r.plays_per_week),
  };
}

/** The row shape the database expects. Empty strings become null, not "". */
export function toRow(p: PlayerProfile, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    display_name: p.displayName.trim() || null,
    level: p.level,
    years_playing: p.yearsPlaying,
    dominant_hand: p.dominantHand,
    height_cm: p.heightCm,
    goals: p.goals.trim() || null,
    injuries: p.injuries.trim() || null,
    plays_per_week: p.playsPerWeek,
  };
}

/**
 * Field-level validation. Returns field → message; empty means valid.
 *
 * The bounds match the CHECK constraints on the table exactly, so the form
 * refuses what the database would refuse anyway and the player reads the
 * reason inline instead of a Postgres error.
 */
export function validate(p: PlayerProfile): Partial<Record<keyof PlayerProfile, string>> {
  const errors: Partial<Record<keyof PlayerProfile, string>> = {};
  if (p.yearsPlaying !== null && (p.yearsPlaying < 0 || p.yearsPlaying > 80)) {
    errors.yearsPlaying = "Somewhere between 0 and 80.";
  }
  if (p.playsPerWeek !== null && (p.playsPerWeek < 0 || p.playsPerWeek > 21)) {
    errors.playsPerWeek = "Sessions a week, 0 to 21.";
  }
  if (p.heightCm !== null && (p.heightCm < 90 || p.heightCm > 250)) {
    errors.heightCm = "In centimetres, between 90 and 250.";
  }
  if (p.displayName.length > 80) errors.displayName = "80 characters or fewer.";
  if (p.goals.length > 600) errors.goals = "600 characters or fewer.";
  if (p.injuries.length > 600) errors.injuries = "600 characters or fewer.";
  return errors;
}
