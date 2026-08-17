/**
 * Backend selection: the persisted setting narrows defensively, the fallback
 * logic always lands on a runnable backend, and availability degrades to false
 * (never a crash) when the racquet-analyzer module can't be required — the
 * Expo Go case. expo-file-system is mocked with an in-memory store so the
 * load/save round-trip runs on Node.
 */
import {
  DEFAULT_ANALYSIS_BACKEND,
  isDeviceAnalysisAvailable,
  loadAnalysisBackend,
  parseBackendSetting,
  resolveBackend,
  saveAnalysisBackend,
} from "../backend";

// Hoisted above the import by babel-jest, so ../backend gets the mock.
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

beforeEach(() => store.clear());

/** A loader whose result satisfies the module contract's API surface. */
const workingModule = {
  extractReferenceFrame: () => Promise.resolve({ uri: "file:///f.jpg", width: 1, height: 1 }),
  analyzeMatch: () => Promise.resolve("{}"),
  addListener: () => ({ remove: () => {} }),
};

describe("resolveBackend fallback logic", () => {
  it("uses the device only when chosen AND the module is available", () => {
    expect(resolveBackend("device", true)).toBe("device");
  });

  it("falls back to the server when the module is unavailable (Expo Go)", () => {
    expect(resolveBackend("device", false)).toBe("server");
  });

  it("respects an explicit server choice regardless of availability", () => {
    expect(resolveBackend("server", true)).toBe("server");
    expect(resolveBackend("server", false)).toBe("server");
  });
});

describe("isDeviceAnalysisAvailable", () => {
  it("is false when the module cannot be required (Expo Go / no dev build)", () => {
    expect(
      isDeviceAnalysisAvailable(() => {
        throw new Error("Cannot find module 'racquet-analyzer'");
      }),
    ).toBe(false);
  });

  it("is false by default in this test environment (no module on disk)", () => {
    // The real require("racquet-analyzer") path: nothing to resolve → false.
    expect(isDeviceAnalysisAvailable()).toBe(false);
  });

  it("is true when the module loads as a default export", () => {
    expect(isDeviceAnalysisAvailable(() => ({ default: workingModule }))).toBe(true);
  });

  it("is true when the module's API sits on the export record itself", () => {
    expect(isDeviceAnalysisAvailable(() => workingModule)).toBe(true);
  });

  it("is false when the loaded module misses part of the contract", () => {
    expect(isDeviceAnalysisAvailable(() => ({}))).toBe(false);
    expect(
      isDeviceAnalysisAvailable(() => ({
        default: { extractReferenceFrame: workingModule.extractReferenceFrame },
      })),
    ).toBe(false);
    expect(isDeviceAnalysisAvailable(() => null)).toBe(false);
    expect(isDeviceAnalysisAvailable(() => "not a module")).toBe(false);
  });
});

describe("parseBackendSetting", () => {
  it("reads both backends from a v1 file", () => {
    expect(parseBackendSetting('{"v":1,"backend":"device"}')).toBe("device");
    expect(parseBackendSetting('{"v":1,"backend":"server"}')).toBe("server");
  });

  it("rejects malformed and wrong-version payloads", () => {
    expect(parseBackendSetting("not json")).toBeNull();
    expect(parseBackendSetting("[]")).toBeNull();
    expect(parseBackendSetting("null")).toBeNull();
    expect(parseBackendSetting('{"backend":"device"}')).toBeNull();
    expect(parseBackendSetting('{"v":2,"backend":"device"}')).toBeNull();
    expect(parseBackendSetting('{"v":1,"backend":"cloud"}')).toBeNull();
    expect(parseBackendSetting('{"v":1,"backend":42}')).toBeNull();
  });
});

describe("loadAnalysisBackend / saveAnalysisBackend", () => {
  it("defaults to the device backend when nothing is saved", () => {
    expect(DEFAULT_ANALYSIS_BACKEND).toBe("device");
    expect(loadAnalysisBackend()).toBe("device");
  });

  it("round-trips a saved choice", () => {
    expect(saveAnalysisBackend("server")).toBe(true);
    expect(loadAnalysisBackend()).toBe("server");
    expect(saveAnalysisBackend("device")).toBe(true);
    expect(loadAnalysisBackend()).toBe("device");
  });

  it("degrades a corrupt config file to the default instead of throwing", () => {
    store.set("analysis-backend.json", "{corrupt");
    expect(loadAnalysisBackend()).toBe(DEFAULT_ANALYSIS_BACKEND);
    store.set("analysis-backend.json", '{"v":1,"backend":"mainframe"}');
    expect(loadAnalysisBackend()).toBe(DEFAULT_ANALYSIS_BACKEND);
  });
});
