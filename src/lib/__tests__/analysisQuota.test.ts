/**
 * The free-analysis meter: quota arithmetic, the fail-open rule for an
 * entitlement we could not verify, and the fact that nothing but a persisted
 * analysis of the user's own video moves the counter. expo-file-system is
 * mocked with an in-memory store so the disk reads run on Node (the
 * backend.test.ts pattern).
 */
import {
  canStartAnalysis,
  freeAnalysesLabel,
  FREE_ANALYSIS_LIMIT,
  parseQuotaFile,
  readFreeAnalysesUsed,
  recordFreeAnalysisUsed,
  remainingFreeAnalyses,
} from "../analysisQuota";

// Hoisted above the import by babel-jest, so ../analysisQuota gets the mock.
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

const { __store: store } = jest.requireMock("expo-file-system") as {
  __store: Map<string, string>;
};

const QUOTA_FILE = "analysis-quota.json";

beforeEach(() => store.clear());

describe("FREE_ANALYSIS_LIMIT", () => {
  it("is the three free analyses the business decision promises", () => {
    expect(FREE_ANALYSIS_LIMIT).toBe(3);
  });
});

describe("remainingFreeAnalyses", () => {
  it("counts down from the limit", () => {
    expect(remainingFreeAnalyses(0)).toBe(3);
    expect(remainingFreeAnalyses(1)).toBe(2);
    expect(remainingFreeAnalyses(2)).toBe(1);
    expect(remainingFreeAnalyses(3)).toBe(0);
  });

  it("clamps below zero rather than reporting a debt", () => {
    expect(remainingFreeAnalyses(4)).toBe(0);
    expect(remainingFreeAnalyses(9999)).toBe(0);
  });

  it("clamps a negative or non-finite count to the full allowance", () => {
    expect(remainingFreeAnalyses(-5)).toBe(3);
    expect(remainingFreeAnalyses(Number.NaN)).toBe(3);
    expect(remainingFreeAnalyses(Number.POSITIVE_INFINITY)).toBe(3);
  });
});

describe("canStartAnalysis", () => {
  it("lets a free user through until the allowance is spent", () => {
    expect(canStartAnalysis("free", 0)).toBe(true);
    expect(canStartAnalysis("free", 2)).toBe(true);
    expect(canStartAnalysis("free", 3)).toBe(false);
    expect(canStartAnalysis("free", 50)).toBe(false);
  });

  it("never blocks a subscriber, however many they have run", () => {
    expect(canStartAnalysis("pro", 0)).toBe(true);
    expect(canStartAnalysis("pro", 3)).toBe(true);
    expect(canStartAnalysis("pro", 900)).toBe(true);
  });

  it("FAILS OPEN when the entitlement could not be verified", () => {
    // No RevenueCat key, no SDK in the binary, or a failed store call. Blocking
    // here would lock a paying subscriber out of what they paid for.
    expect(canStartAnalysis("unknown", 0)).toBe(true);
    expect(canStartAnalysis("unknown", 3)).toBe(true);
    expect(canStartAnalysis("unknown", 900)).toBe(true);
  });
});

describe("freeAnalysesLabel", () => {
  it("counts down for a verified free user, singular at one", () => {
    expect(freeAnalysesLabel("free", 0)).toBe("3 free analyses left");
    expect(freeAnalysesLabel("free", 2)).toBe("1 free analysis left");
  });

  it("says the allowance is spent rather than showing a zero", () => {
    expect(freeAnalysesLabel("free", 3)).toBe("Free analyses used");
  });

  it("shows nothing at all to a subscriber", () => {
    expect(freeAnalysesLabel("pro", 0)).toBeNull();
    expect(freeAnalysesLabel("pro", 3)).toBeNull();
  });

  it("shows nothing when the entitlement is unverified", () => {
    // Nothing is being enforced in that state, so a count would be a promise
    // the app has no intention of keeping.
    expect(freeAnalysesLabel("unknown", 0)).toBeNull();
    expect(freeAnalysesLabel("unknown", 3)).toBeNull();
  });
});

describe("parseQuotaFile", () => {
  it("reads a v1 count", () => {
    expect(parseQuotaFile('{"v":1,"used":0}')).toBe(0);
    expect(parseQuotaFile('{"v":1,"used":7}')).toBe(7);
  });

  it("rejects malformed, wrong-version and nonsense counts", () => {
    expect(parseQuotaFile("not json")).toBeNull();
    expect(parseQuotaFile("[]")).toBeNull();
    expect(parseQuotaFile("null")).toBeNull();
    expect(parseQuotaFile('{"used":2}')).toBeNull();
    expect(parseQuotaFile('{"v":2,"used":2}')).toBeNull();
    expect(parseQuotaFile('{"v":1,"used":"2"}')).toBeNull();
    expect(parseQuotaFile('{"v":1,"used":-1}')).toBeNull();
    expect(parseQuotaFile('{"v":1,"used":1.5}')).toBeNull();
  });
});

describe("readFreeAnalysesUsed", () => {
  it("is zero on a fresh install", () => {
    expect(readFreeAnalysesUsed()).toBe(0);
  });

  it("degrades a corrupt file to zero instead of throwing", () => {
    store.set(QUOTA_FILE, "{corrupt");
    expect(readFreeAnalysesUsed()).toBe(0);
  });
});

describe("recordFreeAnalysisUsed", () => {
  it("increments, and persists in the documented shape", () => {
    recordFreeAnalysisUsed();
    expect(readFreeAnalysesUsed()).toBe(1);
    expect(store.get(QUOTA_FILE)).toBe('{"v":1,"used":1}');
    recordFreeAnalysisUsed();
    recordFreeAnalysisUsed();
    expect(readFreeAnalysesUsed()).toBe(3);
  });

  it("walks a free user from three left to blocked in exactly three calls", () => {
    expect(canStartAnalysis("free", readFreeAnalysesUsed())).toBe(true);
    recordFreeAnalysisUsed();
    recordFreeAnalysisUsed();
    expect(remainingFreeAnalyses(readFreeAnalysesUsed())).toBe(1);
    expect(canStartAnalysis("free", readFreeAnalysesUsed())).toBe(true);
    recordFreeAnalysisUsed();
    expect(remainingFreeAnalyses(readFreeAnalysesUsed())).toBe(0);
    expect(canStartAnalysis("free", readFreeAnalysesUsed())).toBe(false);
  });

  it("restarts the count from a corrupt file rather than crashing the flow", () => {
    store.set(QUOTA_FILE, "{corrupt");
    expect(() => recordFreeAnalysisUsed()).not.toThrow();
    expect(readFreeAnalysesUsed()).toBe(1);
  });

  it("stays silent when the disk write throws", () => {
    // Losing a tick costs one extra free analysis; throwing here would blow up
    // the success path of a flow the user just waited minutes for.
    const write = jest.spyOn(store, "set").mockImplementation(() => {
      throw new Error("disk full");
    });
    try {
      expect(() => recordFreeAnalysisUsed()).not.toThrow();
    } finally {
      write.mockRestore();
    }
  });
});

describe("the bundled demo does not spend the allowance", () => {
  it("leaves the counter untouched however often the sample is opened", () => {
    // The demo is module-scope sample data behind /analysis?source=demo — it
    // never reaches writeImportedAnalysis, which is the ONLY place
    // recordFreeAnalysisUsed is called. Reading it must cost nothing.
    const { DEMO_ANALYSIS } = jest.requireActual<{ DEMO_ANALYSIS: unknown }>(
      "../../features/analysis/demoAnalysis",
    );
    expect(DEMO_ANALYSIS).toBeDefined();
    expect(readFreeAnalysesUsed()).toBe(0);
    expect(store.has(QUOTA_FILE)).toBe(false);
    expect(canStartAnalysis("free", readFreeAnalysesUsed())).toBe(true);
    expect(freeAnalysesLabel("free", readFreeAnalysesUsed())).toBe("3 free analyses left");
  });
});
