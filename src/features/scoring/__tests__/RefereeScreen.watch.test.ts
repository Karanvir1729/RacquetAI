/**
 * The Score keeper with the camera watching, driven through a faked native
 * session.
 *
 * The one property worth more than all the others: A RALLY-END EVENT NEVER
 * CHANGES THE SCORE. Everything else here is in service of that — that the
 * question can be answered either way in one tap, that dismissing it costs
 * nothing, that the manual buttons behave identically whether the camera is
 * running or not, and that when the native half is missing the screen is simply
 * the tap-driven referee with no broken camera on it.
 *
 * Only the hosts are faked: the filesystem, the router, safe-area insets,
 * expo-speech, and the analyzer module itself. The scoring engine, the
 * announcement builder, the proposal wording and the screen are all real.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

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
  // The screen holds a keep-awake for as long as it is focused; under the test
  // renderer there is no navigator, so run the effect once and keep its cleanup.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require("react") as typeof import("react");
    useEffect(() => effect(), [effect]);
  },
}));

jest.mock("expo-speech", () => {
  const spoken: string[] = [];
  return { speak: (text: string) => spoken.push(text), stop: jest.fn(), __spoken: spoken };
});

/**
 * The native module. `virtual` because racquet-analyzer is an OPTIONAL Expo
 * local module that is not installed into node_modules — which is exactly why
 * the other referee test exercises the missing-module path for free.
 */
/**
 * Built OUTSIDE the factory, and referenced by a `mock`-prefixed name.
 *
 * babel-plugin-jest-hoist reads the parameter names inside a type annotation as
 * variable accesses, so a properly typed fake cannot live in the factory body
 * at all. It is safe out here because the require it answers is lazy — it
 * happens when the screen first mounts, long after this initializes.
 */
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
  starts: 0,
  stops: 0,
};

const mockAnalyzer = {
  default: {
    liveRefereePermissions: () => mockNative.permissions,
    requestLiveRefereePermissions: async () => mockNative.permissions,
    startLiveReferee: async () => {
      mockNative.starts += 1;
      return mockNative.status;
    },
    stopLiveReferee: async () => {
      mockNative.stops += 1;
      return { ...mockNative.status, state: "stopped" };
    },
    liveRefereeStatus: () => mockNative.status,
    refreshLiveRefereeOrientation: () => {},
    addListener: (name: string, fn: (event: unknown) => void) => {
      mockNative.listeners.set(name, fn);
      return { remove: () => mockNative.listeners.delete(name) };
    },
    getLivePreviewComponent: () => mockNative.preview,
  },
};

// racquet-analyzer is an OPTIONAL Expo local module that is not installed into
// node_modules — which is also why the sibling referee test exercises the
// missing-module path for free.
jest.mock("racquet-analyzer", () => mockAnalyzer, { virtual: true });

const { __store: store } = jest.requireMock("expo-file-system") as { __store: Map<string, string> };
const speech = jest.requireMock("expo-speech") as { __spoken: string[]; stop: jest.Mock };
const native = mockNative;

const MATCH_FILE = "referee-match.json";
const PREFS_FILE = "referee-prefs.json";

const RUNNING = { ...native.status };

beforeEach(() => {
  store.clear();
  // This file is about the screen that ASKS: autopilot off, and disclosed so
  // no first-run alert stands between the tap and the camera. Autopilot's own
  // behaviour is pinned in RefereeScreen.autopilot.test.ts.
  store.set(
    PREFS_FILE,
    JSON.stringify({ v: 1, muted: false, autopilot: false, autopilotDisclosed: true }),
  );
  speech.__spoken.length = 0;
  speech.stop.mockClear();
  native.listeners.clear();
  native.preview = "LivePreviewView";
  native.permissions = { camera: "granted", microphone: "granted" };
  native.status = { ...RUNNING };
  native.starts = 0;
  native.stops = 0;
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

/** Push one native event into the screen, the way the module would. */
async function emit(name: string, payload: unknown): Promise<void> {
  const listener = native.listeners.get(name);
  if (listener === undefined) throw new Error(`nothing is listening for "${name}"`);
  await act(async () => {
    listener(payload);
  });
}

const WATCH = "Watch the court with the camera";
const A_WON = "Player A won the rally";
const B_WON = "Player B won the rally";
const NO_POINT = "No point — dismiss the question without scoring";

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

/** Mount and get the camera running. */
async function watching(): Promise<ReactTestRenderer> {
  const tree = await mount();
  await press(tree, WATCH);
  // The start path awaits permissions and then the session; flush both.
  await act(async () => {});
  return tree;
}

describe("starting and stopping", () => {
  it("offers to watch, and shows the court once it is running", async () => {
    const tree = await watching();
    expect(native.starts).toBe(1);
    expect(text(tree)).toContain("Watching");
    expect(tree.root.findAllByType("LivePreviewView" as never)).toHaveLength(1);
  });

  it("keeps the rally buttons on screen the whole time it is watching", async () => {
    const tree = await watching();
    expect(findPressable(tree, A_WON)).toBeDefined();
    expect(findPressable(tree, B_WON)).toBeDefined();
  });

  it("releases the camera when the screen goes away", async () => {
    const tree = await watching();
    await act(async () => tree.unmount());
    expect(native.stops).toBeGreaterThanOrEqual(1);
  });

  it("releases the camera when watching is turned off", async () => {
    const tree = await watching();
    await press(tree, "Stop watching");
    expect(native.stops).toBe(1);
    expect(text(tree)).toContain("Referee");
  });
});

describe("a rally end is a question, not a point", () => {
  it("does not score anything on its own", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).toContain("Point to Player A?");
  });

  it("asks out loud, as a question, with the score it would make", async () => {
    await watching();
    await emit("liveRallyEnded", RALLY_END);
    expect(speech.__spoken.at(-1)).toBe("Point to Player A? That would be one, love.");
  });

  it("stays a question for as long as nobody answers it", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    // A minute of squash goes by. Nothing in this screen commits on a timer, so
    // the question is still exactly where it was and the score has not moved —
    // this is the auto-confirm-with-timeout that the measured accuracy ruled
    // out, and it must stay ruled out.
    jest.useFakeTimers();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    jest.useRealTimers();
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).toContain("Point to Player A?");
  });

  it("marks the suggested player on their own rally button", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    expect(findPressable(tree, A_WON).props.accessibilityHint).toContain("Suggested");
    expect(findPressable(tree, B_WON).props.accessibilityHint).toBeUndefined();
  });
});

describe("answering it", () => {
  it("confirms in one tap, on the button that was already there", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    await press(tree, A_WON);
    const events = saved()?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "rally", winner: "A" });
    // And the call — a real call this time — follows.
    expect(speech.__spoken.at(-1)).toBe("One, love.");
  });

  it("corrects in one tap, on the other button", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    await press(tree, B_WON);
    expect(saved()?.events[0]).toMatchObject({ kind: "rally", winner: "B" });
  });

  it("clears the question once it has been answered, so nobody taps twice", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    await press(tree, A_WON);
    expect(text(tree)).not.toContain("Point to Player A?");
    expect(findPressable(tree, A_WON).props.accessibilityHint).toBeUndefined();
  });

  it("dismisses without scoring when the rally had not actually ended", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    await press(tree, NO_POINT);
    expect(saved()?.events ?? []).toHaveLength(0);
    expect(text(tree)).not.toContain("Point to Player A?");
  });
});

describe("when the detection is doing badly", () => {
  it("stops naming a player once shots keep landing after the question", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", RALLY_END);
    await emit("liveStrike", {
      t: 28,
      striker: "B",
      peak: 1,
      margin: 0.5,
      fromWrist: true,
      indexInRally: 8,
      gateWarm: true,
    });
    const rendered = text(tree);
    expect(rendered).toContain("Who won that rally?");
    expect(rendered).toContain("playing again");
    expect(findPressable(tree, A_WON).props.accessibilityHint).toBeUndefined();
  });

  it("asks an open question when the last striker could not be read", async () => {
    const tree = await watching();
    await emit("liveRallyEnded", { ...RALLY_END, proposedWinner: null, recommendation: "ask" });
    expect(text(tree)).toContain("Who won that rally?");
    expect(speech.__spoken.at(-1)).toBe("Rally over? I could not tell who hit last.");
  });

  it("says plainly that it cannot hear, rather than watching in silence", async () => {
    native.status = { ...RUNNING, detectionAvailable: false };
    const tree = await watching();
    expect(text(tree)).toContain("No microphone");
  });

  it("falls back to tapping when the session refuses to run", async () => {
    native.status = { ...RUNNING, state: "failed", problem: "camera-denied" };
    const tree = await watching();
    const rendered = text(tree);
    expect(rendered).toContain("Camera access is off");
    expect(rendered).toContain("Referee");
    expect(findPressable(tree, A_WON)).toBeDefined();
  });
});

describe("the camera while the app is away", () => {
  /**
   * React Native's jest AppState is an inert stub with no emitter, so the
   * listener is captured off `addEventListener` and driven directly.
   */
  function captureAppState(): { send: (state: AppStateStatus) => Promise<void> } {
    let listener: ((state: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      handler: (state: AppStateStatus) => void,
    ) => {
      listener = handler;
      return { remove: () => {} };
    }) as never);
    return {
      send: async (state) => {
        await act(async () => {
          listener?.(state);
        });
      },
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it("releases the camera on background and takes it back on return", async () => {
    // A phone pocketed between games must not sit there holding the camera for
    // the rest of the match.
    const appState = captureAppState();
    const tree = await watching();
    expect(native.starts).toBe(1);

    await appState.send("background");
    expect(native.stops).toBe(1);
    expect(text(tree)).not.toContain("Watching the court");

    await appState.send("active");
    expect(native.starts).toBe(2);
    expect(text(tree)).toContain("Watching the court");
  });

  it("ignores 'inactive', which is a permission alert, not a departure", async () => {
    const appState = captureAppState();
    await watching();
    await appState.send("inactive");
    expect(native.stops).toBe(0);
  });

  it("does not take the camera when the user never asked to watch", async () => {
    const appState = captureAppState();
    await mount();
    await appState.send("active");
    expect(native.starts).toBe(0);
  });
});

describe("a binary that cannot watch", () => {
  it("hides the offer entirely rather than showing a broken camera", async () => {
    // The module is there but the preview view is not — one of the several
    // ways "the native half is missing" actually presents.
    native.preview = null;
    const tree = await mount();
    expect(findPressable(tree, WATCH)).toBeUndefined();
    expect(native.starts).toBe(0);
    // ...and the tap-driven referee is untouched.
    await press(tree, A_WON);
    expect(saved()?.events).toHaveLength(1);
  });
});

describe("the manual referee is never a mode you have to leave", () => {
  it("scores, undoes and mutes while the camera is running", async () => {
    const tree = await watching();
    await press(tree, A_WON);
    await press(tree, B_WON);
    expect(saved()?.events).toHaveLength(2);

    await press(tree, "Undo");
    expect(saved()?.events).toHaveLength(1);
    expect(speech.__spoken.at(-1)).toBe("Correction. One, love.");

    await press(tree, "Mute score announcements");
    await press(tree, A_WON);
    expect(speech.__spoken.at(-1)).toBe("Correction. One, love.");
  });

  it("keeps the question silent while muted, but still on screen", async () => {
    const tree = await watching();
    await press(tree, "Mute score announcements");
    speech.__spoken.length = 0;
    await emit("liveRallyEnded", RALLY_END);
    expect(speech.__spoken).toEqual([]);
    expect(text(tree)).toContain("Point to Player A?");
  });
});
