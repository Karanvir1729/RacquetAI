/**
 * Autopilot, driven through the real screen and a faked native session.
 *
 * Autopilot is the ONE path in this feature where a machine changes the score,
 * so the tests are about its fences rather than its happy path:
 *
 * - off by default, and off means the old behaviour exactly — a minute of fake
 *   time changes nothing;
 * - armed, it commits a `suggest`-level rally end after the countdown and says
 *   the marker's call out loud;
 * - a human tap always beats the clock, and the point goes where the human
 *   said, once;
 * - an `ask`-level end — unreadable striker, weak confidence, or play that
 *   carried on — is never committed, however the switch is set. Autopilot
 *   stops waiting for a tap; it never guesses harder than the evidence.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AUTOPILOT_DELAY_MS } from "../autopilot";
import { RefereeScreen } from "../RefereeScreen";
import { parseStoredMatch, parseRefereePrefs } from "../storage";

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

const mockNative = {
  listeners: new Map<string, (event: unknown) => void>(),
  preview: "LivePreviewView" as unknown,
  permissions: { camera: "granted", microphone: "granted" },
  status: {
    state: "running",
    cameraAuthorized: true,
    microphoneAuthorized: true,
    detectionAvailable: true,
    courtCalibrated: false,
    problem: null,
    thermalState: "nominal",
    poseHz: 9,
    framesProcessed: 0,
    framesSkipped: 0,
    poseFailures: 0,
  } as Record<string, unknown>,
};

const mockAnalyzer = {
  default: {
    liveRefereePermissions: () => mockNative.permissions,
    requestLiveRefereePermissions: async () => mockNative.permissions,
    startLiveReferee: async () => mockNative.status,
    stopLiveReferee: async () => ({ ...mockNative.status, state: "stopped" }),
    liveRefereeStatus: () => mockNative.status,
    refreshLiveRefereeOrientation: () => {},
    addListener: (name: string, fn: (event: unknown) => void) => {
      mockNative.listeners.set(name, fn);
      return { remove: () => mockNative.listeners.delete(name) };
    },
    getLivePreviewComponent: () => mockNative.preview,
  },
};

jest.mock("racquet-analyzer", () => mockAnalyzer, { virtual: true });

const { __store: store } = jest.requireMock("expo-file-system") as { __store: Map<string, string> };
const speech = jest.requireMock("expo-speech") as { __spoken: string[]; stop: jest.Mock };
const native = mockNative;

const MATCH_FILE = "referee-match.json";
const PREFS_FILE = "referee-prefs.json";
const RUNNING = { ...native.status };

const WATCH = "Watch the court with the camera";
const AUTOPILOT = "Autopilot — let the camera score rallies on its own";
/** The same control, in the courtside row that stays reachable while watching. */
const AUTOPILOT_ON_PILL = "Autopilot is on — tap to go back to confirming each rally";
const A_WON = "Player A won the rally";
const B_WON = "Player B won the rally";

/** A confident, readable rally end: the only kind autopilot may commit. */
const RALLY_END = {
  rallyStartT: 10,
  lastStrikeT: 22.5,
  decidedAtT: 27,
  gapS: 4.5,
  strikes: 7,
  proposedWinner: "A",
  confidence: 0.6,
  recommendation: "propose",
  trigger: "silence",
  factors: { gap: 0.8, attribution: 0.9 },
  ceiling: 0.727,
  ceilingSampleSize: 11,
  why: "Player A struck last, then 4.5 s with no detected shot (threshold 4.5 s).",
};

beforeEach(() => {
  store.clear();
  speech.__spoken.length = 0;
  speech.stop.mockClear();
  native.listeners.clear();
  native.preview = "LivePreviewView";
  native.permissions = { camera: "granted", microphone: "granted" };
  native.status = { ...RUNNING };
});

afterEach(() => {
  jest.useRealTimers();
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

/** The switch answers to onValueChange, not onPress. */
async function toggle(tree: ReactTestRenderer, label: string): Promise<void> {
  const node = tree.root.findAll(
    (instance) =>
      instance.props.accessibilityLabel === label &&
      typeof instance.props.onValueChange === "function",
  )[0];
  if (node === undefined) throw new Error(`no switch labelled "${label}"`);
  await act(async () => {
    node.props.onValueChange(!node.props.value);
  });
}

function text(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function saved() {
  const raw = store.get(MATCH_FILE);
  return raw === undefined ? null : parseStoredMatch(raw);
}

async function emit(name: string, payload: unknown): Promise<void> {
  const listener = native.listeners.get(name);
  if (listener === undefined) throw new Error(`nothing is listening for "${name}"`);
  await act(async () => {
    listener(payload);
  });
}

/** Arm autopilot (or not) and get the camera running. */
async function watching(armed: boolean): Promise<ReactTestRenderer> {
  const tree = await mount();
  if (armed) await toggle(tree, AUTOPILOT);
  await press(tree, WATCH);
  await act(async () => {});
  return tree;
}

/** Run the countdown out, with a second to spare. */
async function runCountdown(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(AUTOPILOT_DELAY_MS + 1000);
  });
}

describe("the switch itself", () => {
  it("is off until a human turns it on, and says what off means", async () => {
    const tree = await mount();
    expect(text(tree)).toContain("Your tap is what scores the point");
  });

  it("warns out loud when it is armed", async () => {
    const tree = await mount();
    await toggle(tree, AUTOPILOT);
    // Said as a warning, not a confirmation: from here the app changes the
    // score itself, and two players on court cannot see the switch.
    expect(speech.__spoken.at(-1)).toContain("I will score each rally myself");
  });

  it("persists, and says what ON means in terms of being wrong", async () => {
    const tree = await mount();
    await toggle(tree, AUTOPILOT);
    expect(parseRefereePrefs(store.get(PREFS_FILE) ?? "")?.autopilot).toBe(true);
    expect(text(tree)).toContain("one rally in four wrong");
  });
});

describe("with autopilot off", () => {
  it("still commits nothing on a timer", async () => {
    jest.useFakeTimers();
    const tree = await watching(false);
    await emit("liveRallyEnded", RALLY_END);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).toContain("Point to Player A?");
  });
});

describe("with autopilot on", () => {
  it("counts down in view, naming the player and the way out", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    expect(text(tree)).toContain("Scoring to Player A in");
    expect(text(tree)).toContain("tap the other player to correct");
    // Nothing has been scored while the clock is still running.
    expect(saved()?.events ?? []).toHaveLength(0);
  });

  it("scores the rally when the countdown runs out, and says the score", async () => {
    jest.useFakeTimers();
    await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    await runCountdown();
    const events = saved()?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "rally", winner: "A" });
    // The marker's call, not a question: a human-free decision still gets read
    // out, which is the whole point of a referee that talks.
    expect(speech.__spoken.at(-1)).toBe("One, love.");
  });

  it("does not also ask the question out loud first", async () => {
    jest.useFakeTimers();
    await watching(true);
    // Arming it speaks once; nothing after that until the call itself.
    speech.__spoken.length = 0;
    await emit("liveRallyEnded", RALLY_END);
    // The countdown is on screen; a spoken question four seconds ahead of the
    // call would be cut off mid-sentence by the call itself.
    expect(speech.__spoken).toEqual([]);
  });

  it("marks the point as one nobody confirmed", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    await runCountdown();
    expect(text(tree)).toContain("Scored by autopilot");
  });

  it("lets a tap beat the clock, and scores it exactly once", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    // The camera said A. The human says B, before the clock runs out.
    await press(tree, B_WON);
    await runCountdown();
    const events = saved()?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "rally", winner: "B" });
    expect(text(tree)).not.toContain("Scored by autopilot");
  });

  it("lets a confirming tap beat the clock too, without double-scoring", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    await press(tree, A_WON);
    await runCountdown();
    expect(saved()?.events ?? []).toHaveLength(1);
  });

  it("commits nothing when the question was dismissed", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    await press(tree, "No point — dismiss the question without scoring");
    await runCountdown();
    expect(saved()?.events ?? []).toHaveLength(0);
  });

  it("never commits a rally end it could only ask about", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    // No readable last striker — 21% of real rally ends look like this.
    await emit("liveRallyEnded", { ...RALLY_END, proposedWinner: null, recommendation: "ask" });
    await runCountdown();
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).toContain("Who won that rally?");
  });

  it("never commits once play has resumed — the break was not a rally end", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    // Fake timers freeze the clock, and "play resumed" is a comparison of two
    // timestamps — without advancing it, the strike lands in the same
    // millisecond as the question and reads as having come first.
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await emit("liveStrike", { t: 30, striker: "B", indexInRally: 8, confidence: 0.8 });
    await runCountdown();
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).toContain("playing again");
  });

  it("stops the clock when autopilot is switched off mid-countdown", async () => {
    jest.useFakeTimers();
    const tree = await watching(true);
    await emit("liveRallyEnded", RALLY_END);
    // The entry screen's switch is gone once the camera has the screen, so the
    // way to disarm it is the courtside pill — a machine scoring points that
    // nobody present can stop is the one state this must never reach.
    await press(tree, AUTOPILOT_ON_PILL);
    await runCountdown();
    expect(saved()?.events ?? []).toHaveLength(0);
  });
});
