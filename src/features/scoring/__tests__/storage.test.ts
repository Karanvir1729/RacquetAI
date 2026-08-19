/**
 * The match-in-progress sidecar. The screen's promise is that a backgrounded
 * or killed app does not cost the players their score, so these tests care
 * about two things: a real match survives a round trip, and a damaged file
 * NEVER produces a half-parsed score (which would be read out loud as fact).
 *
 * expo-file-system is mocked with an in-memory store — the analysisQuota.test
 * pattern.
 */
import {
  MAX_PLAYER_NAME_LENGTH,
  parseMutedPref,
  parseStoredMatch,
  readAnnouncementsMuted,
  readAutopilotDisclosed,
  readRefereePrefs,
  readStoredMatch,
  sanitizePlayerName,
  serializeStoredMatch,
  StoredMatch,
  writeAnnouncementsMuted,
  writeAutopilotDisclosed,
  writeStoredMatch,
} from "../storage";
import { reduceSquashEvents } from "../squash";

// Hoisted above the import by babel-jest, so ../storage gets the mock.
jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  class MockFile {
    private readonly key: string;
    constructor(_parent: unknown, name: string) {
      this.key = name;
    }
    get exists(): boolean {
      return store.has(this.key);
    }
    create(): void {
      if (!store.has(this.key)) store.set(this.key, "");
    }
    write(text: string): void {
      store.set(this.key, text);
    }
    textSync(): string {
      const text = store.get(this.key);
      if (text === undefined) throw new Error(`no such file: ${this.key}`);
      // A file that exists and cannot be read — a different failure from a
      // file full of junk, and one the prefs reader must not treat as a new
      // install.
      if (text === "__throws__") throw new Error(`unreadable: ${this.key}`);
      return text;
    }
  }
  return { File: MockFile, Paths: { document: "/documents" }, __store: store };
});

const { __store: store } = jest.requireMock("expo-file-system") as {
  __store: Map<string, string>;
};

const MATCH_FILE = "referee-match.json";
const PREFS_FILE = "referee-prefs.json";

beforeEach(() => store.clear());

const MATCH: StoredMatch = {
  v: 1,
  startedAt: "2026-08-18T18:00:00.000Z",
  names: { A: "Priya", B: "Sam" },
  firstServer: "B",
  events: [
    { id: "e1", at: 1_770_000_000_000, kind: "serve-box", box: "left" },
    { id: "e2", at: 1_770_000_030_000, kind: "rally", winner: "B" },
    { id: "e3", at: 1_770_000_060_000, kind: "let-decision", appealer: "A", ruling: "stroke" },
  ],
};

describe("parseStoredMatch", () => {
  it("round-trips a real match, every event kind intact", () => {
    expect(parseStoredMatch(serializeStoredMatch(MATCH))).toEqual(MATCH);
  });

  it("restores enough to re-fold the exact same score", () => {
    const restored = parseStoredMatch(serializeStoredMatch(MATCH));
    expect(restored).not.toBeNull();
    const before = reduceSquashEvents(MATCH.events, undefined, MATCH.firstServer);
    const after = reduceSquashEvents(restored!.events, undefined, restored!.firstServer);
    expect(after).toEqual(before);
  });

  it.each([
    ["not json", "{"],
    ["not an object", "42"],
    ["an array", "[]"],
    ["an unknown schema version", JSON.stringify({ ...MATCH, v: 2 })],
    ["a missing start time", JSON.stringify({ ...MATCH, startedAt: "" })],
    ["a bogus first server", JSON.stringify({ ...MATCH, firstServer: "C" })],
    ["events that are not a list", JSON.stringify({ ...MATCH, events: {} })],
    ["missing names", JSON.stringify({ ...MATCH, names: null })],
  ])("rejects %s", (_label, raw) => {
    expect(parseStoredMatch(raw)).toBeNull();
  });

  it.each([
    ["an unknown event kind", { id: "e4", at: 1, kind: "conduct-stroke" }],
    ["a rally with no winner", { id: "e4", at: 1, kind: "rally" }],
    ["a rally won by nobody real", { id: "e4", at: 1, kind: "rally", winner: "C" }],
    [
      "an appeal with a bogus ruling",
      { id: "e4", at: 1, kind: "let-decision", appealer: "A", ruling: "maybe" },
    ],
    ["a box choice for a third box", { id: "e4", at: 1, kind: "serve-box", box: "middle" }],
    ["an event with no id", { at: 1, kind: "rally", winner: "A" }],
    ["an event with a junk timestamp", { id: "e4", at: "soon", kind: "rally", winner: "A" }],
  ])("rejects the WHOLE file over %s, rather than folding a partial match", (_label, bad) => {
    const raw = JSON.stringify({ ...MATCH, events: [...MATCH.events, bad] });
    expect(parseStoredMatch(raw)).toBeNull();
  });
});

describe("sanitizePlayerName", () => {
  it("trims and keeps a real name", () => {
    expect(sanitizePlayerName("  Priya  ", "Player A")).toBe("Priya");
  });

  it("falls back when there is nothing usable", () => {
    expect(sanitizePlayerName("   ", "Player A")).toBe("Player A");
    expect(sanitizePlayerName(undefined, "Player A")).toBe("Player A");
    expect(sanitizePlayerName(7, "Player B")).toBe("Player B");
  });

  it("caps the length so a name cannot break the scoreboard", () => {
    const long = "x".repeat(MAX_PLAYER_NAME_LENGTH + 40);
    expect(sanitizePlayerName(long, "Player A")).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });
});

describe("the match file on disk", () => {
  it("has no match before one is written", () => {
    expect(readStoredMatch()).toBeNull();
  });

  it("survives the write/read cycle a backgrounded app depends on", () => {
    writeStoredMatch(MATCH);
    expect(readStoredMatch()).toEqual(MATCH);
  });

  it("reads a corrupt file as no match instead of throwing on a cold start", () => {
    store.set(MATCH_FILE, "half a fi");
    expect(() => readStoredMatch()).not.toThrow();
    expect(readStoredMatch()).toBeNull();
  });

  it("overwrites in place, so the file is always the current match", () => {
    writeStoredMatch(MATCH);
    const next: StoredMatch = { ...MATCH, events: MATCH.events.slice(0, 1) };
    writeStoredMatch(next);
    expect(readStoredMatch()).toEqual(next);
  });
});

describe("the mute preference", () => {
  it("defaults to unmuted — the screen exists to speak", () => {
    expect(readAnnouncementsMuted()).toBe(false);
  });

  it("persists both ways", () => {
    writeAnnouncementsMuted(true);
    expect(readAnnouncementsMuted()).toBe(true);
    writeAnnouncementsMuted(false);
    expect(readAnnouncementsMuted()).toBe(false);
  });

  it("lives in its own file, so a new match cannot un-mute the phone", () => {
    writeAnnouncementsMuted(true);
    writeStoredMatch(MATCH);
    expect(store.has(PREFS_FILE)).toBe(true);
    expect(readAnnouncementsMuted()).toBe(true);
  });

  it("reads junk as unmuted rather than throwing", () => {
    store.set(PREFS_FILE, "{{{");
    expect(readAnnouncementsMuted()).toBe(false);
    expect(parseMutedPref("{{{")).toBeNull();
    expect(parseMutedPref(JSON.stringify({ v: 2, muted: true }))).toBeNull();
    expect(parseMutedPref(JSON.stringify({ v: 1, muted: "yes" }))).toBeNull();
  });
});

/**
 * The autopilot preference, which owns a decision the rest of the app only
 * reads: whether a machine may change the score without being asked.
 *
 * The rule has two halves and the second one is the one that breaks silently.
 * A NEW install gets autopilot on. A phone that already has this app does NOT
 * — its prefs file predates the feature and says nothing about it, and folding
 * that onto the new default would arm autopilot on somebody mid-season without
 * a tap, a prompt or a word.
 */
describe("the autopilot preference", () => {
  it("is on for a brand-new install, and undisclosed", () => {
    expect(readRefereePrefs()).toEqual({
      muted: false,
      autopilot: true,
      autopilotDisclosed: false,
    });
  });

  it("is OFF for a file written before autopilot existed", () => {
    // The exact bytes the pre-autopilot build wrote.
    store.set(PREFS_FILE, JSON.stringify({ v: 1, muted: true }));
    const prefs = readRefereePrefs();
    expect(prefs.muted).toBe(true);
    expect(prefs.autopilot).toBe(false);
  });

  it("keeps an explicit choice either way", () => {
    store.set(PREFS_FILE, JSON.stringify({ v: 1, muted: false, autopilot: false }));
    expect(readRefereePrefs().autopilot).toBe(false);
    store.set(PREFS_FILE, JSON.stringify({ v: 1, muted: false, autopilot: true }));
    expect(readRefereePrefs().autopilot).toBe(true);
  });

  it("does not arm autopilot off the back of a damaged file", () => {
    for (const damaged of ["{{{", JSON.stringify({ v: 2, autopilot: true }), "", "[]"]) {
      store.set(PREFS_FILE, damaged);
      expect(readRefereePrefs().autopilot).toBe(false);
    }
  });

  it("does not arm autopilot off the back of a disk error", () => {
    store.set(PREFS_FILE, "__throws__");
    expect(readRefereePrefs().autopilot).toBe(false);
  });

  it("does not smuggle the new default into a legacy file on a mute toggle", () => {
    // The irreversible one: writeRefereePrefs persists all three keys, so if a
    // legacy read inherited autopilot:true, one tap on the mute control would
    // freeze it there and make it indistinguishable from consent forever.
    store.set(PREFS_FILE, JSON.stringify({ v: 1, muted: false }));
    writeAnnouncementsMuted(true);
    expect(store.get(PREFS_FILE)).toBe(
      JSON.stringify({ v: 1, muted: true, autopilot: false, autopilotDisclosed: false }),
    );
  });

  it("round-trips the disclosure flag", () => {
    writeAutopilotDisclosed(true);
    expect(readAutopilotDisclosed()).toBe(true);
    expect(readRefereePrefs().autopilot).toBe(true);
  });
});
