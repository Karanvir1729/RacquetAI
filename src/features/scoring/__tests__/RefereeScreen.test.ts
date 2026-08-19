/**
 * The Score keeper end to end through the wiring: tap → event appended → score
 * re-folded → line announced → match written to disk. announce.test.ts covers
 * the wording and storage.test.ts covers the file; what is at risk HERE is the
 * join, and two specific promises the screen makes:
 *
 * - undo is one tap and is implemented as "drop the last event and re-fold",
 *   never as an inverse mutation;
 * - a backgrounded or killed app resumes on the same score.
 *
 * Only the hosts are faked: the filesystem, the router, safe-area insets, and
 * expo-speech. The reducer, the announcement builder and the screen itself are
 * all real.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RefereeScreen } from "../RefereeScreen";
import { parseStoredMatch } from "../storage";

// Hoisted above the imports by babel-jest, so the modules under test get these.
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
  return {
    speak: (text: string) => spoken.push(text),
    stop: jest.fn(),
    __spoken: spoken,
  };
});

const { __store: store } = jest.requireMock("expo-file-system") as {
  __store: Map<string, string>;
};
const speech = jest.requireMock("expo-speech") as { __spoken: string[]; stop: jest.Mock };

const MATCH_FILE = "referee-match.json";
const PREFS_FILE = "referee-prefs.json";

beforeEach(() => {
  store.clear();
  speech.__spoken.length = 0;
  speech.stop.mockClear();
});

/** Mount the screen. Async act so the icon font's own state update settles. */
async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(RefereeScreen));
  });
  return tree;
}

/** Press the one control carrying this exact accessibility label. */
async function press(tree: ReactTestRenderer, label: string): Promise<void> {
  const [node] = tree.root.findAll(
    (instance) =>
      instance.props.accessibilityLabel === label && typeof instance.props.onPress === "function",
  );
  if (node === undefined) throw new Error(`no pressable labelled "${label}"`);
  await act(async () => {
    node.props.onPress();
  });
}

/** The last thing said out loud. */
function lastSpoken(): string | undefined {
  return speech.__spoken[speech.__spoken.length - 1];
}

/** The persisted match, parsed the way a cold start would parse it. */
function saved() {
  const raw = store.get(MATCH_FILE);
  return raw === undefined ? null : parseStoredMatch(raw);
}

const A_WON = "Player A won the rally";
const B_WON = "Player B won the rally";

describe("scoring a rally", () => {
  it("calls the score out loud, server first", async () => {
    const tree = await mount();
    await press(tree, A_WON);
    expect(lastSpoken()).toBe("One, love.");
  });

  it("announces the change of hand when the receiver wins", async () => {
    const tree = await mount();
    await press(tree, B_WON);
    expect(lastSpoken()).toBe("Hand out. One, love.");
  });

  it("shows the same line on screen, so muting costs no information", async () => {
    const tree = await mount();
    await press(tree, A_WON);
    expect(JSON.stringify(tree.toJSON())).toContain("One, love.");
  });

  it("writes the match after every single call", async () => {
    const tree = await mount();
    await press(tree, A_WON);
    expect(saved()?.events).toHaveLength(1);
    await press(tree, B_WON);
    expect(saved()?.events).toHaveLength(2);
    expect(saved()?.events.map((e) => (e.kind === "rally" ? e.winner : e.kind))).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("undo", () => {
  it("drops the last event rather than inverting it", async () => {
    const tree = await mount();
    await press(tree, A_WON);
    await press(tree, A_WON);
    await press(tree, B_WON);
    expect(saved()?.events).toHaveLength(3);
    await press(tree, "Undo");
    const events = saved()?.events ?? [];
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.kind === "rally" && event.winner === "A")).toBe(true);
  });

  it("re-announces the score it went back to, flagged as a correction", async () => {
    const tree = await mount();
    await press(tree, A_WON);
    await press(tree, B_WON);
    await press(tree, "Undo");
    expect(lastSpoken()).toBe("Correction. One, love.");
  });

  it("undoes all the way to love all without going negative", async () => {
    const tree = await mount();
    await press(tree, A_WON);
    await press(tree, "Undo");
    expect(saved()?.events).toHaveLength(0);
    expect(lastSpoken()).toBe("Correction. Love all.");
    // Disabled at zero events — nothing left to take back.
    await press(tree, "Undo");
    expect(saved()?.events).toHaveLength(0);
  });
});

describe("a match in progress survives the app going away", () => {
  it("resumes on the same score after a remount", async () => {
    const first = await mount();
    await press(first, A_WON);
    await press(first, A_WON);
    await press(first, B_WON);
    await act(async () => first.unmount());

    const second = await mount();
    const rendered = JSON.stringify(second.toJSON());
    // 2-1 to A, with B serving after taking the last rally.
    expect(saved()?.events).toHaveLength(3);
    expect(rendered).toContain("Player B serves");
    // Undo still works on the restored list — it is the same event list.
    await press(second, "Undo");
    expect(saved()?.events).toHaveLength(2);
  });

  it("resumes a match whose events carry old timestamps", async () => {
    // A refereed video writes rally events stamped in VIDEO time — seconds
    // from the start of the footage, which is a moment in 1970. Freshness has
    // to come from when the match was STARTED in that case, or a scoreline the
    // app produced a second ago looks decades stale and is silently dropped.
    const first = await mount();
    await press(first, A_WON);
    const stored = JSON.parse(store.get(MATCH_FILE) ?? "{}");
    stored.events = stored.events.map((event: { at: number }) => ({ ...event, at: 12_000 }));
    store.set(MATCH_FILE, JSON.stringify(stored));
    await act(async () => first.unmount());

    const second = await mount();
    expect(saved()?.events).toHaveLength(1);
    // The point is still on the board: A won it while serving, so A keeps the
    // serve and the box alternates. A dropped match would read 0-0 on the right.
    expect(JSON.stringify(second.toJSON())).toContain("Player A serves · Left box");
  });

  it("says nothing on restore — a resumed screen must not blurt a stale score", async () => {
    const first = await mount();
    await press(first, A_WON);
    await act(async () => first.unmount());
    speech.__spoken.length = 0;

    await mount();
    expect(speech.__spoken).toEqual([]);
  });
});

describe("the mute toggle", () => {
  it("silences announcements and persists the choice", async () => {
    const tree = await mount();
    await press(tree, "Mute score announcements");
    await press(tree, A_WON);
    expect(speech.__spoken).toEqual([]);
    // Both preferences are written together — autopilot is untouched here and
    // must survive a mute toggle rather than being dropped from the file.
    expect(store.get(PREFS_FILE)).toBe(JSON.stringify({ v: 1, muted: true, autopilot: false }));
  });

  it("still scores, and still shows the call, while muted", async () => {
    const tree = await mount();
    await press(tree, "Mute score announcements");
    await press(tree, A_WON);
    expect(saved()?.events).toHaveLength(1);
    expect(JSON.stringify(tree.toJSON())).toContain("One, love.");
  });

  it("comes back muted on the next visit", async () => {
    const first = await mount();
    await press(first, "Mute score announcements");
    await act(async () => first.unmount());

    const second = await mount();
    await press(second, A_WON);
    expect(speech.__spoken).toEqual([]);
    // The toggle now offers the opposite action, which is how we know it read
    // the persisted preference rather than defaulting.
    expect(JSON.stringify(second.toJSON())).toContain("Turn score announcements on");
  });
});
