import { activeShotIndex, countShotTypes } from "../shots";
import type { ShotEvent, ShotType } from "../types";

const shot = (tSec: number, player: "A" | "B", type?: ShotType): ShotEvent => ({
  tSec,
  player,
  cell: "backLeft",
  ...(type === undefined ? {} : { type }),
});

describe("countShotTypes", () => {
  const shots = [
    shot(1, "A", "drive"),
    shot(2, "B", "drop"),
    shot(3, "A", "drop"),
    shot(4, "A", "drive"),
    shot(5, "A", "boast"),
    shot(6, "A", "drive"),
  ];

  it("counts one player's shots, most frequent first", () => {
    expect(countShotTypes(shots, "A")).toEqual([
      { type: "drive", count: 3 },
      { type: "drop", count: 1 },
      { type: "boast", count: 1 },
    ]);
    expect(countShotTypes(shots, "B")).toEqual([{ type: "drop", count: 1 }]);
  });

  it("sinks the unclassified count below every real class", () => {
    expect(
      countShotTypes([shot(1, "A", "unknown"), shot(2, "A", "unknown"), shot(3, "A", "drop")], "A"),
    ).toEqual([
      { type: "drop", count: 1 },
      { type: "unknown", count: 2 },
    ]);
  });

  it("is empty for a v1 analysis, where no shot carries a type", () => {
    expect(countShotTypes([shot(1, "A"), shot(2, "A")], "A")).toEqual([]);
    expect(countShotTypes([], "A")).toEqual([]);
  });
});

describe("activeShotIndex", () => {
  const shots = [shot(1, "A", "serve"), shot(2.5, "B", "drive"), shot(4, "A", "drop")];

  it("highlights the latest contact behind the playhead", () => {
    expect(activeShotIndex(shots, 1)).toBe(0);
    expect(activeShotIndex(shots, 2.4)).toBe(0);
    expect(activeShotIndex(shots, 2.5)).toBe(1);
    expect(activeShotIndex(shots, 4.9)).toBe(2);
  });

  it("clears between shots and before the first one", () => {
    expect(activeShotIndex(shots, 0.5)).toBeNull();
    expect(activeShotIndex(shots, 8)).toBeNull();
  });

  it("does not assume the shot list is in order", () => {
    const jumbled = [shot(4, "A", "drop"), shot(1, "A", "serve"), shot(2.5, "B", "drive")];
    expect(activeShotIndex(jumbled, 2.6)).toBe(2);
    expect(activeShotIndex(jumbled, 4.2)).toBe(0);
  });

  it("returns null for an unusable time or an empty list", () => {
    expect(activeShotIndex(shots, Number.NaN)).toBeNull();
    expect(activeShotIndex([], 1)).toBeNull();
  });
});
