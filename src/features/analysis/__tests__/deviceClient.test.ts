/**
 * deviceClient: the racquet-analyzer wrapper narrows everything that crosses
 * the native bridge — the returned analysis.json must survive parseAnalysis
 * before anyone persists it, progress events map onto the server flow's
 * JobStatus stage model, and the serialized corners/options match the module
 * contract. The module itself is a hand-rolled fake injected through the
 * wrapper's module parameter (the makeImportedAnalysisId injection pattern).
 */
import { DEMO_ANALYSIS } from "../demoAnalysis";
import {
  DeviceAnalysisError,
  deviceCornersJson,
  deviceOptionsJson,
  extractDeviceReferenceFrame,
  progressEventToJobStatus,
  runDeviceAnalysis,
  type RacquetAnalyzerModule,
} from "../deviceClient";
import type { CourtCorners, JobStatus } from "../jobContract";

const VALID_RAW = JSON.stringify(DEMO_ANALYSIS);

const CORNERS: CourtCorners = {
  frontLeft: { x: 0.1234567, y: 0.2 },
  frontRight: { x: 0.9, y: 0.2 },
  backLeft: { x: -0.05, y: 1.02 },
  backRight: { x: 1, y: 0.98 },
};

const FRAME = { uri: "file:///cache/frame.jpg", width: 1920, height: 1080 };

interface FakeModule extends RacquetAnalyzerModule {
  analyzeMatch: jest.Mock;
  removeCount: number;
}

/**
 * A fake native module: analyzeMatch emits `events` to the analysisProgress
 * listener, then resolves (or rejects) with `result`.
 */
function fakeModule(result: unknown, options: { events?: unknown[]; reject?: boolean } = {}) {
  const listeners: ((event: unknown) => void)[] = [];
  const module: FakeModule = {
    removeCount: 0,
    extractReferenceFrame: jest.fn(() => Promise.resolve<unknown>(FRAME)),
    analyzeMatch: jest.fn(() => {
      for (const event of options.events ?? []) {
        for (const listener of listeners) listener(event);
      }
      return options.reject ? Promise.reject(result) : Promise.resolve(result);
    }),
    addListener: (_name: string, listener: (event: unknown) => void) => {
      listeners.push(listener);
      return {
        remove: () => {
          module.removeCount += 1;
        },
      };
    },
  };
  return module;
}

describe("runDeviceAnalysis", () => {
  it("resolves with the raw JSON string when the module returns a valid analysis", async () => {
    const module = fakeModule(VALID_RAW);
    await expect(runDeviceAnalysis("file:///v.mp4", CORNERS, () => {}, module)).resolves.toBe(
      VALID_RAW,
    );
    expect(module.analyzeMatch).toHaveBeenCalledWith(
      "file:///v.mp4",
      deviceCornersJson(CORNERS),
      '{"sampleFps":8}',
    );
    expect(module.removeCount).toBe(1);
  });

  it("rejects JSON that fails parseAnalysis validation", async () => {
    const invalid = JSON.stringify({ ...DEMO_ANALYSIS, schemaVersion: 2 });
    await expect(
      runDeviceAnalysis("file:///v.mp4", CORNERS, () => {}, fakeModule(invalid)),
    ).rejects.toBeInstanceOf(DeviceAnalysisError);
    await expect(
      runDeviceAnalysis("file:///v.mp4", CORNERS, () => {}, fakeModule("not json {")),
    ).rejects.toBeInstanceOf(DeviceAnalysisError);
  });

  it("rejects a non-string result (a misbehaving module)", async () => {
    await expect(
      runDeviceAnalysis("file:///v.mp4", CORNERS, () => {}, fakeModule(DEMO_ANALYSIS)),
    ).rejects.toBeInstanceOf(DeviceAnalysisError);
  });

  it("wraps a native failure in a user-readable error and still unsubscribes", async () => {
    const module = fakeModule(new Error("decoder gave up"), { reject: true });
    await expect(runDeviceAnalysis("file:///v.mp4", CORNERS, () => {}, module)).rejects.toThrow(
      /decoder gave up/,
    );
    expect(module.removeCount).toBe(1);
  });

  it("forwards mapped progress events and drops malformed ones", async () => {
    const seen: JobStatus[] = [];
    const module = fakeModule(VALID_RAW, {
      events: [
        { stage: "decoding", pct: 10 },
        { stage: "warp-drive", pct: 50 }, // unknown stage → dropped
        "junk", // not even a record → dropped
        { stage: "stats", pct: 250 }, // pct clamped
      ],
    });
    await runDeviceAnalysis("file:///v.mp4", CORNERS, (status) => seen.push(status), module);
    expect(seen).toEqual([
      { status: "analyzing", progressPct: 10, message: "Decoding video…" },
      { status: "analyzing", progressPct: 100, message: "Computing match stats…" },
    ]);
  });

  it("rejects up-front when the module is unavailable (Expo Go)", async () => {
    await expect(
      runDeviceAnalysis("file:///v.mp4", CORNERS, () => {}, null),
    ).rejects.toBeInstanceOf(DeviceAnalysisError);
  });
});

describe("extractDeviceReferenceFrame", () => {
  it("narrows a well-formed frame result", async () => {
    await expect(
      extractDeviceReferenceFrame("file:///v.mp4", fakeModule(VALID_RAW)),
    ).resolves.toEqual(FRAME);
  });

  it("rejects a malformed frame result", async () => {
    const module = fakeModule(VALID_RAW);
    module.extractReferenceFrame = jest.fn(() => Promise.resolve<unknown>({ uri: "" }));
    await expect(extractDeviceReferenceFrame("file:///v.mp4", module)).rejects.toBeInstanceOf(
      DeviceAnalysisError,
    );
  });

  it("wraps a native rejection in a user-readable error", async () => {
    const module = fakeModule(VALID_RAW);
    module.extractReferenceFrame = jest.fn(() => Promise.reject(new Error("no video track")));
    await expect(extractDeviceReferenceFrame("file:///v.mp4", module)).rejects.toBeInstanceOf(
      DeviceAnalysisError,
    );
  });

  it("rejects when the module is unavailable", async () => {
    await expect(extractDeviceReferenceFrame("file:///v.mp4", null)).rejects.toBeInstanceOf(
      DeviceAnalysisError,
    );
  });
});

describe("progressEventToJobStatus", () => {
  it("maps every contract stage onto the analyzing status with a readable message", () => {
    for (const stage of ["decoding", "pose", "audio", "stats"]) {
      const status = progressEventToJobStatus({ stage, pct: 42 });
      expect(status).toMatchObject({ status: "analyzing", progressPct: 42 });
      expect(typeof status?.message).toBe("string");
    }
  });

  it("clamps pct into 0..100 and degrades a junk pct to null", () => {
    expect(progressEventToJobStatus({ stage: "pose", pct: -5 })?.progressPct).toBe(0);
    expect(progressEventToJobStatus({ stage: "pose", pct: 400 })?.progressPct).toBe(100);
    expect(progressEventToJobStatus({ stage: "pose", pct: "half" })?.progressPct).toBeNull();
    expect(progressEventToJobStatus({ stage: "pose" })?.progressPct).toBeNull();
  });

  it("returns null for unknown stages and junk payloads", () => {
    expect(progressEventToJobStatus({ stage: "uploading", pct: 1 })).toBeNull();
    expect(progressEventToJobStatus({ pct: 1 })).toBeNull();
    expect(progressEventToJobStatus(null)).toBeNull();
    expect(progressEventToJobStatus([])).toBeNull();
  });
});

describe("deviceCornersJson / deviceOptionsJson", () => {
  it("serializes corners as {cell: [nx, ny]} rounded to 4 dp, in contract order", () => {
    expect(deviceCornersJson(CORNERS)).toBe(
      '{"frontLeft":[0.1235,0.2],"frontRight":[0.9,0.2],"backLeft":[-0.05,1.02],"backRight":[1,0.98]}',
    );
  });

  it("does NOT clamp — corners may sit outside the camera frame", () => {
    const parsed = JSON.parse(deviceCornersJson(CORNERS)) as Record<string, [number, number]>;
    expect(parsed.backLeft).toEqual([-0.05, 1.02]);
  });

  it("defaults options to the contract's 8 fps sampling", () => {
    expect(deviceOptionsJson()).toBe('{"sampleFps":8}');
    expect(deviceOptionsJson(4)).toBe('{"sampleFps":4}');
  });
});
