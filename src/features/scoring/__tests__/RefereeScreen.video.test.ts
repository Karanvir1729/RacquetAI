/**
 * "Score a video", driven through the real screen.
 *
 * The properties that matter here are different from the live ones. Nobody is
 * courtside while a video is scored, so the fences are about what the user is
 * left holding afterwards:
 *
 * - the result lands in the ORDINARY match — persisted, undoable one rally at
 *   a time, and correctable on the same two buttons;
 * - it is spoken out loud, but as a reconstruction to check, never as a
 *   marker's call;
 * - swapping the players re-folds the whole scoreline rather than editing it;
 * - footage with nothing to score says why instead of showing 0-0 as a result.
 *
 * The source list is faked (a directory API the file-system mock does not
 * have); the rally split, the fold, the wording and the screen are all real.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { MatchAnalysis, ShotEvent } from "@/features/analysis/types";

import { RefereeScreen } from "../RefereeScreen";
import { parseStoredMatch } from "../storage";

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
      return text;
    }
  }
  return { File: MockFile, Paths: { document: "/documents" }, __store: store };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => ({
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

jest.mock("expo-speech", () => {
  const spoken: string[] = [];
  return { speak: (text: string) => spoken.push(text), stop: jest.fn(), __spoken: spoken };
});

/** Shots from "ABAB"-style rally strings, one shot a second, 6 s between. */
function shotsFrom(rallies: string[]): ShotEvent[] {
  const shots: ShotEvent[] = [];
  let t = 0;
  for (const rally of rallies) {
    for (const player of rally) {
      shots.push({ tSec: t, player: player as "A" | "B", cell: "frontLeft" });
      t += 1;
    }
    t += 6;
  }
  return shots;
}

function analysisWith(shots: ShotEvent[]): MatchAnalysis {
  return {
    schemaVersion: 1,
    video: { durationSec: 600, width: 1920, height: 1080, fps: 30 },
    court: { cells: [] },
    players: [],
    rallies: { count: 0, avgShotsPerRally: 0, longestRally: 0 },
    shots,
    quality: {
      framesAnalyzed: 100,
      bothPlayersDetectedPct: 90,
      audioAvailable: true,
      notes: [],
    },
  } as unknown as MatchAnalysis;
}

const mockSources = {
  analysis: analysisWith(shotsFrom(["BA", "BA", "AB"])),
};

jest.mock("../videoSources", () => {
  const actual = jest.requireActual("../videoSources");
  return {
    ...actual,
    // The bundled demo: an analysis with no footage, so this file drives the
    // one-pass path. The played path is RefereeScreen.playback.test.ts.
    listVideoSources: () => [
      { id: "demo", kind: "demo", createdAt: null, durationSec: null, videoUri: null },
    ],
    loadVideoAnalysis: () => mockSources.analysis,
  };
});

// The native analyzer is absent, exactly as in a Simulator build: the live
// option disappears and scoring a video is the only thing on offer, which is
// the case this file is about.
const { __store: store } = jest.requireMock("expo-file-system") as { __store: Map<string, string> };
const speech = jest.requireMock("expo-speech") as { __spoken: string[]; stop: jest.Mock };

const MATCH_FILE = "referee-match.json";
const PREFS_FILE = "referee-prefs.json";
const PICK_VIDEO = "Score a video that has already been analysed";
const PICK_DEMO = "Score Demo match";
const SWAP = "Swap which player the video calls A — mirrors the whole scoreline";
const A_WON = "Player A won the rally";
const UNDO = "Undo";

beforeEach(() => {
  store.clear();
  // Autopilot is about the live camera, which this binary does not have; the
  // seed keeps the first-run alert out of the way of the video path.
  store.set(
    PREFS_FILE,
    JSON.stringify({ v: 1, muted: false, autopilot: false, autopilotDisclosed: true }),
  );
  speech.__spoken.length = 0;
  mockSources.analysis = analysisWith(shotsFrom(["BA", "BA", "AB"]));
});

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(RefereeScreen));
  });
  return tree;
}

function findPressable(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (instance) =>
      instance.props.accessibilityLabel === label && typeof instance.props.onPress === "function",
  )[0];
}

async function press(tree: ReactTestRenderer, label: string): Promise<void> {
  const node = findPressable(tree, label);
  if (node === undefined) throw new Error(`no pressable labelled "${label}"`);
  await act(async () => {
    node.props.onPress();
  });
}

function text(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function saved() {
  const raw = store.get(MATCH_FILE);
  return raw === undefined ? null : parseStoredMatch(raw);
}

/** Open the picker and score the one source in it. */
async function scoreVideo(tree: ReactTestRenderer): Promise<void> {
  await press(tree, PICK_VIDEO);
  await press(tree, PICK_DEMO);
}

describe("the way in", () => {
  it("shows no back chevron on the tab — there is nothing behind it", async () => {
    const tree = await mount();
    // The router reports canGoBack() inside a tab navigator as soon as any tab
    // has been visited, so the control is gated on how the screen was entered.
    expect(findPressable(tree, "Back to Library")).toBeUndefined();
  });

  it("offers scoring a video even with no camera in the binary", async () => {
    const tree = await mount();
    expect(findPressable(tree, PICK_VIDEO)).toBeDefined();
    // The live option is hidden rather than shown broken.
    expect(findPressable(tree, "Watch the court with the camera")).toBeUndefined();
  });

  it("warns about the compounding before anything is scored", async () => {
    const tree = await mount();
    await press(tree, PICK_VIDEO);
    const rendered = text(tree);
    expect(rendered).toContain("whoever hit last");
    expect(rendered).toContain("draft to correct, not a result");
  });
});

describe("scoring a video", () => {
  it("folds the rallies into the ordinary match, on disk", async () => {
    const tree = await mount();
    await scoreVideo(tree);
    const events = saved()?.events ?? [];
    // Three rallies, last strikers A, A, B.
    expect(events).toHaveLength(3);
    expect(events.map((event) => (event.kind === "rally" ? event.winner : null))).toEqual([
      "A",
      "A",
      "B",
    ]);
  });

  it("says the score out loud, as something to check", async () => {
    const tree = await mount();
    await scoreVideo(tree);
    const line = speech.__spoken.at(-1) ?? "";
    expect(line).toContain("3 rallies scored from the video");
    // A leads 2-1. Leader first, NOT the marker's server-first order, which
    // would say "one, two" here and sound like the opposite of what it means.
    expect(line).toContain("Player A ahead, two one");
    expect(line).toContain("Check it against what you remember");
  });

  it("shows what it had to throw away", async () => {
    // A stray onset between two rallies: a door, a bounce, a ball pickup.
    mockSources.analysis = analysisWith(shotsFrom(["BA", "A", "AB"]));
    const tree = await mount();
    await scoreVideo(tree);
    expect(text(tree)).toContain("1 stray sound skipped");
  });

  it("leaves the buttons live — scoring continues from where the video left off", async () => {
    const tree = await mount();
    await scoreVideo(tree);
    await press(tree, A_WON);
    expect(saved()?.events ?? []).toHaveLength(4);
  });

  it("undoes the video's rallies one at a time, like any other", async () => {
    const tree = await mount();
    await scoreVideo(tree);
    await press(tree, UNDO);
    expect(saved()?.events ?? []).toHaveLength(2);
  });

  it("mirrors the whole scoreline when the players are swapped", async () => {
    const tree = await mount();
    await scoreVideo(tree);
    await press(tree, SWAP);
    const events = saved()?.events ?? [];
    expect(events.map((event) => (event.kind === "rally" ? event.winner : null))).toEqual([
      "B",
      "B",
      "A",
    ]);
  });
});

describe("footage there is nothing to score in", () => {
  it("says why, and scores nothing", async () => {
    mockSources.analysis = analysisWith([]);
    const tree = await mount();
    await scoreVideo(tree);
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).toContain("No shots were detected");
  });
});
