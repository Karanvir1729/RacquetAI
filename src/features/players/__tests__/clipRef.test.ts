import { clipRefForRecording, recordingInstant } from "../clipRef";
import { isoDay } from "../shape";

describe("recordingInstant", () => {
  it("reads the UTC stamp off a recording id", () => {
    const made = recordingInstant("rec-20260815-142312-x7k2");
    expect(made?.toISOString()).toBe("2026-08-15T14:23:12.000Z");
  });

  it("reads the same stamp off an imported-analysis id", () => {
    const made = recordingInstant("imp-20260816-000000-ab12");
    expect(made?.toISOString()).toBe("2026-08-16T00:00:00.000Z");
  });

  it("is null for ids that carry no timestamp", () => {
    expect(recordingInstant("demo")).toBeNull();
    expect(recordingInstant("rec-2026-08-15")).toBeNull();
    expect(recordingInstant("job-20260815-142312-x7k2")).toBeNull();
    expect(recordingInstant("")).toBeNull();
  });
});

describe("clipRefForRecording", () => {
  const today = new Date(2026, 7, 21, 9, 30);

  it("keys the clip by the phone's id with no job id", () => {
    const ref = clipRefForRecording("rec-20260815-142312-x7k2", today);
    expect(ref.jobId).toBeNull();
    expect(ref.historyId).toBe("rec-20260815-142312-x7k2");
  });

  it("defaults 'played on' to the day the recording was made, in local time", () => {
    const ref = clipRefForRecording("rec-20260815-142312-x7k2", today);
    expect(ref.playedAt).toBe(isoDay(new Date(Date.UTC(2026, 7, 15, 14, 23, 12))));
    expect(ref.playedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to today for an id without a timestamp", () => {
    expect(clipRefForRecording("something-else", today).playedAt).toBe("2026-08-21");
  });

  it("titles an import as one and a recording as the screen that showed it", () => {
    expect(clipRefForRecording("imp-20260816-000000-ab12", today).title).toBe("Imported analysis");
    expect(clipRefForRecording("rec-20260815-142312-x7k2", today).title).toBe("Match analysis");
  });
});
