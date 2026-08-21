/**
 * The profile's rules, tested without a database.
 *
 * The bounds here mirror CHECK constraints on `public.player_profiles`. If the
 * two ever drift, a player gets a raw Postgres error instead of an inline
 * message — so these tests are really asserting that the form refuses exactly
 * what the database refuses.
 */
import {
  EMPTY_PROFILE,
  fromRow,
  isUsable,
  LEVELS,
  LEVEL_LABELS,
  toRow,
  validate,
  type PlayerProfile,
} from "../playerProfileShape";

const filled: PlayerProfile = {
  displayName: "Karan",
  level: "club",
  yearsPlaying: 6,
  dominantHand: "right",
  heightCm: 178,
  goals: "Stop losing long rallies",
  injuries: "Left knee",
  playsPerWeek: 3,
};

describe("player profile shape", () => {
  it("accepts an empty profile — every field is optional", () => {
    expect(validate(EMPTY_PROFILE)).toEqual({});
  });

  it("accepts a fully filled one", () => {
    expect(validate(filled)).toEqual({});
  });

  it("refuses exactly what the database CHECK constraints refuse", () => {
    expect(validate({ ...filled, yearsPlaying: 81 }).yearsPlaying).toBeDefined();
    expect(validate({ ...filled, yearsPlaying: -1 }).yearsPlaying).toBeDefined();
    expect(validate({ ...filled, yearsPlaying: 80 }).yearsPlaying).toBeUndefined();

    expect(validate({ ...filled, playsPerWeek: 22 }).playsPerWeek).toBeDefined();
    expect(validate({ ...filled, playsPerWeek: 21 }).playsPerWeek).toBeUndefined();

    expect(validate({ ...filled, heightCm: 89 }).heightCm).toBeDefined();
    expect(validate({ ...filled, heightCm: 251 }).heightCm).toBeDefined();
    expect(validate({ ...filled, heightCm: 90 }).heightCm).toBeUndefined();
    expect(validate({ ...filled, heightCm: 250 }).heightCm).toBeUndefined();
  });

  it("caps the free-text fields", () => {
    expect(validate({ ...filled, goals: "x".repeat(601) }).goals).toBeDefined();
    expect(validate({ ...filled, goals: "x".repeat(600) }).goals).toBeUndefined();
    expect(validate({ ...filled, displayName: "x".repeat(81) }).displayName).toBeDefined();
  });

  it("knows when there is enough for the coach to be specific", () => {
    expect(isUsable(EMPTY_PROFILE)).toBe(false);
    expect(isUsable({ ...EMPTY_PROFILE, goals: "   " })).toBe(false);
    expect(isUsable({ ...EMPTY_PROFILE, level: "club" })).toBe(true);
    expect(isUsable({ ...EMPTY_PROFILE, goals: "get fitter" })).toBe(true);
  });

  it("every level has a human label", () => {
    for (const level of LEVELS) {
      expect(LEVEL_LABELS[level]).toEqual(expect.any(String));
      expect(LEVEL_LABELS[level].length).toBeGreaterThan(0);
    }
  });

  describe("reading a row back", () => {
    it("round-trips through the database shape", () => {
      expect(fromRow(toRow(filled, "user-1"))).toEqual(filled);
    });

    it("turns blank text into null so the column is empty, not an empty string", () => {
      const row = toRow({ ...EMPTY_PROFILE, displayName: "   ", goals: "" }, "user-1");
      expect(row.display_name).toBeNull();
      expect(row.goals).toBeNull();
    });

    it("treats a malformed row as an absent profile rather than throwing", () => {
      expect(fromRow(null)).toEqual(EMPTY_PROFILE);
      expect(fromRow("nonsense")).toEqual(EMPTY_PROFILE);
      expect(fromRow({})).toEqual(EMPTY_PROFILE);
      expect(() => fromRow({ level: 42, years_playing: "six" })).not.toThrow();
    });

    it("drops values outside the vocabulary instead of trusting them", () => {
      // A level the app no longer knows about must not reach a <select>.
      expect(fromRow({ level: "professional" }).level).toBeNull();
      expect(fromRow({ dominant_hand: "both" }).dominantHand).toBeNull();
      expect(fromRow({ level: "club" }).level).toBe("club");
    });
  });
});
