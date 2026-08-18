import { formatRecordedAt, sportLabel } from "../display";

// Fixed "now": Saturday 2026-08-15, 8:00 PM local time.
const NOW = new Date(2026, 7, 15, 20, 0, 0);

/** Build an ISO string from local-time components, like real sidecars store. */
function localIso(y: number, m: number, d: number, h: number, min: number): string {
  return new Date(y, m, d, h, min, 0).toISOString();
}

describe("formatRecordedAt", () => {
  it("labels a same-day recording Today with a 12-hour clock", () => {
    expect(formatRecordedAt(localIso(2026, 7, 15, 14, 7), NOW)).toBe("Today · 2:07 PM");
  });

  it("renders midnight and noon in 12-hour convention", () => {
    expect(formatRecordedAt(localIso(2026, 7, 15, 0, 4), NOW)).toBe("Today · 12:04 AM");
    expect(formatRecordedAt(localIso(2026, 7, 15, 12, 0), NOW)).toBe("Today · 12:00 PM");
  });

  it("labels the previous calendar day Yesterday, even just before midnight", () => {
    expect(formatRecordedAt(localIso(2026, 7, 14, 23, 59), NOW)).toBe("Yesterday · 11:59 PM");
    expect(formatRecordedAt(localIso(2026, 7, 14, 9, 41), NOW)).toBe("Yesterday · 9:41 AM");
  });

  it("handles yesterday across a year boundary", () => {
    const janFirst = new Date(2026, 0, 1, 10, 0, 0);
    expect(formatRecordedAt(localIso(2025, 11, 31, 22, 15), janFirst)).toBe("Yesterday · 10:15 PM");
  });

  it("uses weekday + day + month within the current year", () => {
    // 2026-08-03 is a Monday.
    expect(formatRecordedAt(localIso(2026, 7, 3, 18, 15), NOW)).toBe("Mon 3 Aug · 6:15 PM");
  });

  it("drops the time and shows the year for older recordings", () => {
    expect(formatRecordedAt(localIso(2025, 11, 31, 23, 59), NOW)).toBe("31 Dec 2025");
  });

  it("never throws on garbage input", () => {
    expect(formatRecordedAt("definitely not a date", NOW)).toBe("Unknown date");
    expect(formatRecordedAt("", NOW)).toBe("Unknown date");
  });
});

describe("sportLabel", () => {
  it("labels squash and the untagged default", () => {
    expect(sportLabel("squash")).toBe("Squash");
    expect(sportLabel("unspecified")).toBe("Untagged");
  });
});
