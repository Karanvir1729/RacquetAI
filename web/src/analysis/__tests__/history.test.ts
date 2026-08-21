/**
 * The browser history store, exercised against a REAL analysis file — the
 * 2MB schema-v2 output shipped as the demo sample — rather than a hand-made
 * object. The whole point of this module is that it survives a real file in a
 * real 5MB budget, and a fixture small enough to always fit would test nothing.
 *
 * `window.localStorage` is stubbed with a store that enforces a byte budget
 * and throws QuotaExceededError like a browser does, because the eviction path
 * is where the bugs are.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clearHistory,
  deleteHistoryEntry,
  listHistory,
  loadHistoryEntry,
  saveToHistory,
} from "../history";
import { parseAnalysisValue, type MatchAnalysis } from "../types";

const SAMPLE_PATH = join(__dirname, "..", "..", "..", "public", "sample", "analysis.json");

const REAL: MatchAnalysis = (() => {
  const parsed = parseAnalysisValue(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
  if (parsed === null) throw new Error("the bundled sample analysis no longer parses");
  return parsed;
})();

interface FakeStorage extends Storage {
  bytes(): number;
  keyList(): string[];
}

/** A localStorage that runs out of room, the way a browser's does. */
function makeStorage(budgetBytes: number): FakeStorage {
  const map = new Map<string, string>();
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    setItem: (k: string, v: string) => {
      const priorPair = map.has(k) ? k.length + (map.get(k) ?? "").length : 0;
      if (used() - priorPair + k.length + v.length > budgetBytes) {
        throw new Error("QuotaExceededError");
      }
      map.set(k, v);
    },
    bytes: used,
    keyList: () => [...map.keys()],
  };
}

function useStorage(store: FakeStorage | "throws"): void {
  const descriptor =
    store === "throws"
      ? {
          get() {
            throw new Error("storage is disabled");
          },
          configurable: true,
        }
      : { value: store, configurable: true, writable: true };
  if (typeof globalThis.window === "undefined") {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  }
  Object.defineProperty(globalThis.window, "localStorage", descriptor);
}

/** The sample, with a rally count we can tell copies apart by. */
function withRallies(count: number): MatchAnalysis {
  return { ...REAL, rallies: { ...REAL.rallies, count } };
}

const at = (msFromEpoch: number) => new Date(1_700_000_000_000 + msFromEpoch);

describe("browser match history", () => {
  it("saves a real analysis and reads the whole read-out back", () => {
    useStorage(makeStorage(5_000_000));
    const id = saveToHistory(REAL, { jobId: "job-a", title: "match.mp4", now: at(0) });
    expect(id).not.toBeNull();

    const listed = listHistory();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("match.mp4");
    expect(listed[0]?.rallies).toBe(REAL.rallies.count);
    expect(listed[0]?.durationSec).toBe(REAL.video.durationSec);

    const back = loadHistoryEntry(id as string);
    expect(back?.shots).toHaveLength(REAL.shots.length);
    expect(back?.players).toHaveLength(REAL.players.length);
    expect(back?.rallies).toEqual(REAL.rallies);
    expect(back?.quality).toEqual(REAL.quality);
  });

  it("drops the pose track, which is all of the weight and none of the read-out", () => {
    const store = makeStorage(5_000_000);
    useStorage(store);
    // Guard the premise: if the sample ever ships without a track, this test
    // would pass while proving nothing.
    expect(REAL.tracks?.length ?? 0).toBeGreaterThan(1000);
    expect(JSON.stringify(REAL).length).toBeGreaterThan(1_000_000);

    const id = saveToHistory(REAL, { jobId: "big", title: "big.mp4", now: at(0) });
    expect(store.bytes()).toBeLessThan(100_000);
    expect(loadHistoryEntry(id as string)?.tracks).toBeUndefined();
    expect(loadHistoryEntry(id as string)?.shots).toHaveLength(REAL.shots.length);
  });

  it("replaces the entry for a job instead of stacking a duplicate", () => {
    useStorage(makeStorage(5_000_000));
    const first = saveToHistory(withRallies(3), { jobId: "same", title: "a.mp4", now: at(0) });
    const second = saveToHistory(withRallies(9), { jobId: "same", title: "a.mp4", now: at(60_000) });

    expect(second).toBe(first);
    expect(listHistory()).toHaveLength(1);
    expect(loadHistoryEntry(first as string)?.rallies.count).toBe(9);
  });

  it("caps the list, keeping the newest and leaving no orphan records", () => {
    useStorage(makeStorage(5_000_000));
    for (let i = 0; i < 45; i += 1) {
      saveToHistory(REAL, { jobId: `j${i}`, title: `m${i}.mp4`, now: at(i * 60_000) });
    }
    const listed = listHistory();
    expect(listed).toHaveLength(40);
    expect(listed[0]?.title).toBe("m44.mp4");
    expect(listed.some((entry) => entry.title === "m0.mp4")).toBe(false);
    expect(listed.every((entry) => loadHistoryEntry(entry.id) !== null)).toBe(true);
  });

  it("evicts rather than failing when the browser runs out of room", () => {
    // Room for roughly two of these, so most saves have to make space first.
    useStorage(makeStorage(80_000));
    let saved = 0;
    for (let i = 0; i < 12; i += 1) {
      if (saveToHistory(REAL, { jobId: `t${i}`, title: `t${i}.mp4`, now: at(i * 60_000) }) !== null) {
        saved += 1;
      }
    }
    expect(saved).toBeGreaterThan(0);
    // The invariant that matters: the list never shows a match it cannot open.
    expect(listHistory().every((entry) => loadHistoryEntry(entry.id) !== null)).toBe(true);
    expect(listHistory()[0]?.title).toBe("t11.mp4");
  });

  it("reports no history rather than throwing when storage is refused", () => {
    useStorage("throws");
    expect(saveToHistory(REAL, { jobId: "x", title: "x.mp4", now: at(0) })).toBeNull();
    expect(listHistory()).toEqual([]);
    expect(loadHistoryEntry("anything")).toBeNull();
    expect(() => clearHistory()).not.toThrow();
  });

  it("deletes one match, and all of them", () => {
    useStorage(makeStorage(5_000_000));
    const first = saveToHistory(REAL, { jobId: "d1", title: "d1.mp4", now: at(0) });
    saveToHistory(REAL, { jobId: "d2", title: "d2.mp4", now: at(60_000) });

    deleteHistoryEntry(first as string);
    expect(listHistory()).toHaveLength(1);
    expect(listHistory()[0]?.title).toBe("d2.mp4");
    expect(loadHistoryEntry(first as string)).toBeNull();

    clearHistory();
    expect(listHistory()).toEqual([]);
  });

  it("treats a corrupt store as empty and keeps working after it", () => {
    const store = makeStorage(5_000_000);
    useStorage(store);
    store.setItem("racketiq.history.v1", "{not json");

    expect(listHistory()).toEqual([]);
    expect(saveToHistory(REAL, { jobId: "r", title: "r.mp4", now: at(0) })).not.toBeNull();
    expect(listHistory()).toHaveLength(1);
  });
});
