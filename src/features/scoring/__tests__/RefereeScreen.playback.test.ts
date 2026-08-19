/**
 * Watching a video referee itself, driven through the real screen with a faked
 * player.
 *
 * The property this file exists for: THE SCORE IS A FUNCTION OF THE PLAYHEAD.
 * Play forward, scrub back, scrub forward again, land on the same second
 * twice — the board reads the same thing every time it is at the same moment.
 * A forward-only cursor passes ordinary playback and is then permanently wrong
 * the first time anybody drags the scrubber back, with nothing on screen to
 * show it.
 *
 * The rest is what a demo hits in its first minute: the calls being spoken one
 * per rally in the marker's own wording, silence on a seek, the video ducking
 * under the voice, and a human correction taking the pen off the video for
 * good rather than being quietly overwritten by the next rally.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { MatchAnalysis, ShotEvent } from "@/features/analysis/types";

/**
 * The fake player registry.
 *
 * IMPORTED from "expo-video", never fetched with `jest.requireMock`: that call
 * instantiates a SECOND copy of the manual mock, so every player the screen
 * creates would land in an array this file never sees. The types come from the
 * mock's own file (type-only, so nothing is loaded twice), because the real
 * module's types have no test hooks on them.
 */
import * as ExpoVideo from "expo-video";

import { RefereeScreen } from "../RefereeScreen";
import { parseStoredMatch } from "../storage";
import { CALL_DELAY_SEC } from "../videoPlayback";

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

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));

/**
 * expo-speech, with the utterance left OPEN until the test finishes it — the
 * duck lasts exactly as long as the voice does, so a test that never lets a
 * line end is the one that proves the video stays quiet meanwhile.
 */
jest.mock("expo-speech", () => {
  const spoken: string[] = [];
  let pending: { onDone?: () => void } | null = null;
  return {
    speak: (text: string, options?: { onDone?: () => void }) => {
      spoken.push(text);
      pending = options ?? null;
    },
    stop: jest.fn(),
    __spoken: spoken,
    __finish: () => {
      const done = pending?.onDone;
      pending = null;
      done?.();
    },
  };
});

/** Shots from "ABAB"-style rally strings: a shot a second, 6 s between. */
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
    quality: { framesAnalyzed: 100, bothPlayersDetectedPct: 90, audioAvailable: true, notes: [] },
  } as unknown as MatchAnalysis;
}

/** Four rallies, last strikers A, A, B, A. Ends at 1, 9, 17, 25 s. */
const RALLIES = ["BA", "BA", "AB", "BA"];
const mockSources = { analysis: analysisWith(shotsFrom(RALLIES)) };

jest.mock("../videoSources", () => {
  const actual = jest.requireActual("../videoSources");
  return {
    ...actual,
    // An imported analysis that adopted a copy of its clip — the only kind
    // that can be watched being scored.
    listVideoSources: () => [
      {
        id: "imp-1",
        kind: "imported",
        createdAt: "2026-08-17T19:30:00.000Z",
        durationSec: null,
        videoUri: "file:///videos/imp-1.mp4",
      },
    ],
    loadVideoAnalysis: () => mockSources.analysis,
  };
});

const { __store: store } = jest.requireMock("expo-file-system") as { __store: Map<string, string> };
const speech = jest.requireMock("expo-speech") as {
  __spoken: string[];
  __finish: () => void;
  stop: jest.Mock;
};


const { __players, __resetPlayers } = ExpoVideo as unknown as typeof import("@mocks/expo-video");

const MATCH_FILE = "referee-match.json";
const PREFS_FILE = "referee-prefs.json";
const PICK_VIDEO = "Score a video that has already been analysed";
/** `formatRecordedAt` phrases the title relative to today, so the row is found
 *  by the one part of its label that never moves. */
function pickSourceLabel(tree: ReactTestRenderer): string {
  const row = tree.root.findAll(
    (instance) =>
      typeof instance.props.accessibilityLabel === "string" &&
      instance.props.accessibilityLabel.startsWith("Score ") &&
      // Not the mode row that OPENED the picker, which starts the same way.
      instance.props.accessibilityLabel !== PICK_VIDEO &&
      typeof instance.props.onPress === "function",
  )[0];
  if (row === undefined) throw new Error("the picker listed no source to score");
  return row.props.accessibilityLabel as string;
}
const A_WON = "Player A won the rally";
const UNDO = "Undo";
const HAND_BACK = "Hand scoring back to the video from here";

beforeEach(() => {
  store.clear();
  store.set(
    PREFS_FILE,
    JSON.stringify({ v: 1, muted: false, autopilot: false, autopilotDisclosed: true }),
  );
  speech.__spoken.length = 0;
  __resetPlayers();
  mockSources.analysis = analysisWith(shotsFrom(RALLIES));
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

function player() {
  const instance = __players.at(-1);
  if (instance === undefined) throw new Error("no video player was created");
  return instance;
}

/** Move the playhead, the way expo-video's timeUpdate would. */
async function seek(seconds: number): Promise<void> {
  await act(async () => {
    player().__emit("timeUpdate", {
      currentTime: seconds,
      currentLiveTimestamp: null,
      bufferedPosition: 0,
    });
  });
}

/** The moment rally `n` (1-based) is called. */
function callAt(n: number): number {
  const ends = [1, 9, 17, 25];
  return (ends[n - 1] ?? 0) + CALL_DELAY_SEC + 0.01;
}

async function watchVideo(tree: ReactTestRenderer): Promise<void> {
  await press(tree, PICK_VIDEO);
  await press(tree, pickSourceLabel(tree));
}

describe("loading a video that can be played", () => {
  it("starts at 0-0 and says what it is about to do", async () => {
    const tree = await mount();
    await watchVideo(tree);
    // Nothing is folded up front: the rallies land as the footage reaches them.
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(speech.__spoken.at(-1)).toContain("I will call each one as the video reaches it");
    expect(tree.root.findAllByType("VideoView" as never)).toHaveLength(1);
  });

  it("does not take the audio session from whatever else is playing", async () => {
    const tree = await mount();
    await watchVideo(tree);
    expect(player().audioMixingMode).toBe("mixWithOthers");
  });
});

describe("the score follows the playhead", () => {
  it("calls each rally as the video reaches it, in the marker's own words", async () => {
    const tree = await mount();
    await watchVideo(tree);

    await seek(callAt(1));
    expect(saved()?.events ?? []).toHaveLength(1);
    expect(speech.__spoken.at(-1)).toBe("One, love.");

    await seek(callAt(2));
    expect(speech.__spoken.at(-1)).toBe("Two, love.");

    // B takes the third off A's serve — a hand out, exactly as a tapped rally
    // would be called.
    await seek(callAt(3));
    expect(speech.__spoken.at(-1)).toContain("Hand out");
    expect(saved()?.events ?? []).toHaveLength(3);
  });

  it("says nothing between rallies", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(1));
    const after = speech.__spoken.length;
    await seek(callAt(1) + 1);
    await seek(callAt(1) + 2);
    expect(speech.__spoken).toHaveLength(after);
  });

  it("rewinds the score when the video is scrubbed back, silently", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(3));
    expect(saved()?.events ?? []).toHaveLength(3);

    const before = speech.__spoken.length;
    await seek(callAt(1));
    // THE regression: a forward-only cursor would still read 3 here.
    expect(saved()?.events ?? []).toHaveLength(1);
    expect(speech.__spoken).toHaveLength(before);
  });

  it("reads the same score at the same moment however it got there", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(2));
    const forwards = saved()?.events?.length;
    await seek(callAt(4));
    await seek(0);
    await seek(callAt(2));
    expect(saved()?.events?.length).toBe(forwards);
  });

  it("catches up in one step on a forward seek, and says nothing", async () => {
    const tree = await mount();
    await watchVideo(tree);
    const before = speech.__spoken.length;
    await seek(callAt(4));
    // The board is right; the voice stays out of it, because the call for the
    // last of four describes a score nobody heard build.
    expect(saved()?.events ?? []).toHaveLength(4);
    expect(speech.__spoken).toHaveLength(before);
  });

  it("ignores a playhead that is not a number", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(2));
    await act(async () => {
      player().__emit("timeUpdate", { currentTime: NaN, currentLiveTimestamp: null });
    });
    expect(saved()?.events ?? []).toHaveLength(2);
  });

  it("takes the whole reconstruction when the video runs out", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(2));
    await act(async () => {
      player().__emit("playToEnd", {});
    });
    // The last rally's call can land past the end of the file, so a played run
    // must still finish where a one-pass run would.
    expect(saved()?.events ?? []).toHaveLength(4);
    expect(speech.__spoken.at(-1)).toContain("rallies scored from the video");
  });
});

describe("hearing the call over the match audio", () => {
  it("ducks the video for exactly as long as the voice is talking", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(1));
    // The line is still being spoken: on iOS both go into one audio session
    // and sum, so an un-ducked call is not quiet, it is unintelligible.
    expect(player().volume).toBeLessThan(0.5);
    await act(async () => {
      speech.__finish();
    });
    expect(player().volume).toBe(1);
  });

  it("gives the audio back when the user takes over mid-call", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(1));
    expect(player().volume).toBeLessThan(0.5);
    await press(tree, UNDO);
    expect(player().volume).toBe(1);
  });
});

describe("when a human corrects it", () => {
  it("stops scoring from the video, and says so", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(2));
    await press(tree, A_WON);
    const afterCorrection = saved()?.events?.length;

    // The playhead carries on — they may be re-watching the rally they just
    // corrected — and it must not reinstate anything.
    await seek(callAt(3));
    await seek(callAt(4));
    expect(saved()?.events?.length).toBe(afterCorrection);
    expect(text(tree)).toContain("the video has stopped scoring");
  });

  it("pauses the footage rather than playing on without scoring", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(1));
    await press(tree, UNDO);
    expect(player().pause).toHaveBeenCalled();
  });

  it("can be handed back, and picks up from where the playhead is", async () => {
    const tree = await mount();
    await watchVideo(tree);
    await seek(callAt(1));
    await press(tree, A_WON);
    // Scrub on while detached, then hand it back: it resumes from HERE, not
    // from where the human took over, or it would replay rallies already on
    // the board.
    await seek(callAt(3));
    await press(tree, HAND_BACK);
    // And it resumes playing on its own — taking over paused the footage.
    expect(player().play).toHaveBeenCalled();
    await seek(callAt(4));
    expect(saved()?.events ?? []).toHaveLength(4);
  });
});
