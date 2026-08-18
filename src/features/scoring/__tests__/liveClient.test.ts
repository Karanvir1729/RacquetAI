/**
 * liveClient: the live referee's JS half.
 *
 * Two things are being pinned here.
 *
 * 1. THE CRASH GUARD. This project shipped six crashing TestFlight builds from
 *    a native module that threw at import time, and the live session adds a
 *    second module surface with the same hazard. Every entry point must
 *    degrade to "unavailable" — never throw — including when merely READING a
 *    property on the module explodes, which is how the real failure presented.
 *
 * 2. THE HONESTY INVARIANT. A rally-end proposal must never present as more
 *    certain than the heuristic behind it was measured to be. The Phase 1
 *    oracle was 8/11 = 72.7% (Wilson 95% CI 43.4%–90.3%), and that was scored
 *    against the true last striker rather than against anything the detector
 *    produces. So `confidence <= ceiling`, always, whatever the bridge sends.
 */
import {
  DEFAULT_TRACK_BINDING,
  flipBinding,
  isLiveRefereeAvailable,
  liveRefereePermissions,
  livePreviewComponent,
  loadLiveReferee,
  parseLivePermissions,
  parseLiveStatus,
  parseRallyEnded,
  parseRallyStarted,
  parseStrike,
  refreshLiveOrientation,
  requestLivePermissions,
  sideForTrack,
  startLiveReferee,
  stopLiveReferee,
  subscribeLiveReferee,
  toProposal,
  type LiveRefereeModule,
} from "../liveClient";

const RUNNING_STATUS = {
  state: "running",
  cameraAuthorized: true,
  microphoneAuthorized: true,
  detectionAvailable: true,
  courtCalibrated: false,
  problem: null,
  thermalState: "fair",
  poseHz: 9,
  framesProcessed: 120,
  framesSkipped: 240,
  poseFailures: 0,
};

const RALLY_END = {
  rallyStartT: 10,
  lastStrikeT: 22.5,
  decidedAtT: 27,
  gapS: 4.5,
  strikes: 7,
  proposedWinner: "B",
  confidence: 0.41,
  recommendation: "ask",
  trigger: "silence",
  factors: { gap: 0.35, attribution: 0.9 },
  ceiling: 0.727,
  ceilingSampleSize: 11,
  why: "Player B struck last, then 4.5 s with no detected shot.",
};

interface FakeModule extends LiveRefereeModule {
  listeners: Map<string, (event: unknown) => void>;
  removeCount: number;
}

function fakeModule(overrides: Partial<LiveRefereeModule> = {}): FakeModule {
  const listeners = new Map<string, (event: unknown) => void>();
  const module: FakeModule = {
    listeners,
    removeCount: 0,
    liveRefereePermissions: () => ({ camera: "granted", microphone: "denied" }),
    requestLiveRefereePermissions: () =>
      Promise.resolve({ camera: "granted", microphone: "granted" }),
    startLiveReferee: () => Promise.resolve(RUNNING_STATUS),
    stopLiveReferee: () => Promise.resolve({ ...RUNNING_STATUS, state: "stopped" }),
    liveRefereeStatus: () => RUNNING_STATUS,
    addListener: (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      return {
        remove: () => {
          module.removeCount += 1;
        },
      };
    },
    ...overrides,
  };
  return module;
}

describe("loadLiveReferee", () => {
  it("is null when the module cannot be required (Expo Go / no dev build)", () => {
    expect(
      loadLiveReferee(() => {
        throw new Error("Cannot find module 'racquet-analyzer'");
      }),
    ).toBeNull();
  });

  it("is null in this test environment, where the native half does not exist", () => {
    expect(loadLiveReferee()).toBeNull();
    expect(isLiveRefereeAvailable()).toBe(false);
  });

  it("loads through a default export and through the record itself", () => {
    const module = fakeModule();
    expect(loadLiveReferee(() => ({ default: module }))).not.toBeNull();
    expect(loadLiveReferee(() => module)).not.toBeNull();
  });

  it("is null when READING a property throws — the shape of the shipped crash", () => {
    // modules/racquet-analyzer resolves its native module lazily behind
    // getters, so a binary without the Swift half throws on property access
    // rather than on require. The whole body has to be guarded, not just the
    // require, or the app dies at import.
    const exploding = {
      get startLiveReferee(): unknown {
        throw new Error("Cannot find native module 'RacquetAnalyzer'");
      },
    };
    expect(loadLiveReferee(() => exploding)).toBeNull();
    expect(loadLiveReferee(() => ({ default: exploding }))).toBeNull();
  });

  it("is null when the module misses part of the live contract", () => {
    expect(loadLiveReferee(() => ({}))).toBeNull();
    expect(
      loadLiveReferee(() => ({ startLiveReferee: () => Promise.resolve(RUNNING_STATUS) })),
    ).toBeNull();
  });
});

describe("entry points with no native module", () => {
  it("start resolves with a failed status rather than throwing", async () => {
    const status = await startLiveReferee({}, null);
    expect(status.state).toBe("failed");
    expect(status.detectionAvailable).toBe(false);
  });

  it("stop resolves with a stopped status", async () => {
    expect((await stopLiveReferee(null)).state).toBe("stopped");
  });

  it("permissions read as undetermined", () => {
    expect(liveRefereePermissions(null)).toEqual({
      camera: "undetermined",
      microphone: "undetermined",
    });
  });

  it("requesting permissions resolves rather than rejecting", async () => {
    await expect(requestLivePermissions(null)).resolves.toEqual({
      camera: "undetermined",
      microphone: "undetermined",
    });
  });

  it("subscribing returns a safe no-op unsubscribe", () => {
    const unsubscribe = subscribeLiveReferee({ onStrike: () => {} }, null);
    expect(() => unsubscribe()).not.toThrow();
  });

  it("the preview component is null, and orientation refresh is a no-op", () => {
    expect(livePreviewComponent(null)).toBeNull();
    expect(() => refreshLiveOrientation(null)).not.toThrow();
  });
});

describe("entry points when the native side throws", () => {
  it("start degrades instead of rejecting", async () => {
    const module = fakeModule({
      startLiveReferee: () => Promise.reject(new Error("AVCaptureSession failed")),
    });
    expect((await startLiveReferee({}, module)).state).toBe("failed");
  });

  it("stop degrades instead of rejecting", async () => {
    const module = fakeModule({ stopLiveReferee: () => Promise.reject(new Error("boom")) });
    expect((await stopLiveReferee(module)).state).toBe("stopped");
  });

  it("reading permissions degrades", () => {
    const module = fakeModule({
      liveRefereePermissions: () => {
        throw new Error("boom");
      },
    });
    expect(liveRefereePermissions(module).camera).toBe("undetermined");
  });

  it("an addListener that throws costs only that one event", () => {
    const seen: string[] = [];
    const module = fakeModule({
      addListener: (name: string) => {
        if (name === "liveStrike") throw new Error("unknown event");
        seen.push(name);
        return { remove: () => {} };
      },
    });
    expect(() => subscribeLiveReferee({ onStrike: () => {} }, module)).not.toThrow();
    expect(seen).toContain("liveRallyEnded");
  });

  it("a preview getter that throws yields null", () => {
    const module = fakeModule({
      getLivePreviewComponent: () => {
        throw new Error("view not registered");
      },
    });
    expect(livePreviewComponent(module)).toBeNull();
  });
});

describe("start/stop against a working module", () => {
  it("passes corners and tuning through as JSON strings", async () => {
    const calls: [string, string][] = [];
    const module = fakeModule({
      startLiveReferee: (cornersJson: string, tuningJson: string) => {
        calls.push([cornersJson, tuningJson]);
        return Promise.resolve(RUNNING_STATUS);
      },
    });
    await startLiveReferee({}, module);
    await startLiveReferee({ cornersJson: '{"frontLeft":[0,0]}', tuning: { rallyGapS: 6 } }, module);
    expect(calls[0]).toEqual(["", ""]);
    expect(calls[1]).toEqual(['{"frontLeft":[0,0]}', '{"rallyGapS":6}']);
  });

  it("narrows the returned status", async () => {
    const status = await startLiveReferee({}, fakeModule());
    expect(status.state).toBe("running");
    expect(status.thermalState).toBe("fair");
    expect(status.courtCalibrated).toBe(false);
  });

  it("unsubscribing removes every subscription it made", () => {
    const module = fakeModule();
    const unsubscribe = subscribeLiveReferee({}, module);
    unsubscribe();
    expect(module.removeCount).toBe(4);
  });

  it("forwards well-formed events and drops malformed ones", () => {
    const module = fakeModule();
    const strikes: unknown[] = [];
    const ends: unknown[] = [];
    subscribeLiveReferee(
      { onStrike: (e) => strikes.push(e), onRallyEnded: (e) => ends.push(e) },
      module,
    );
    const strike = module.listeners.get("liveStrike");
    const end = module.listeners.get("liveRallyEnded");
    strike?.({ t: 1, striker: "A", peak: 3, margin: 0.2, fromWrist: true, indexInRally: 1 });
    strike?.({ t: 1, striker: "Z" }); // unknown track id
    strike?.(null);
    end?.(RALLY_END);
    end?.("nonsense");
    expect(strikes).toHaveLength(1);
    expect(ends).toHaveLength(1);
  });
});

describe("payload narrowing", () => {
  it("rejects malformed rally starts and strikes", () => {
    expect(parseRallyStarted(null)).toBeNull();
    expect(parseRallyStarted({ t: 1 })).toBeNull();
    expect(parseRallyStarted({ t: 1, firstStriker: "A" })).toEqual({ t: 1, firstStriker: "A" });
    expect(parseStrike({ striker: "C" })).toBeNull();
  });

  it("fills missing status fields with safe defaults rather than failing", () => {
    const status = parseLiveStatus({ state: "running" });
    expect(status).not.toBeNull();
    expect(status?.detectionAvailable).toBe(false);
    expect(status?.thermalState).toBe("nominal");
    expect(status?.problem).toBeNull();
  });

  it("drops an unknown problem string instead of passing it through", () => {
    expect(parseLiveStatus({ state: "failed", problem: "aliens" })?.problem).toBeNull();
    expect(parseLiveStatus({ state: "failed", problem: "camera-denied" })?.problem).toBe(
      "camera-denied",
    );
  });

  it("defaults unknown permission strings to undetermined", () => {
    expect(parseLivePermissions({ camera: "yes", microphone: "granted" })).toEqual({
      camera: "undetermined",
      microphone: "granted",
    });
  });

  it("keeps only finite numeric confidence factors", () => {
    const parsed = parseRallyEnded({
      ...RALLY_END,
      factors: { gap: 0.5, bad: "x", worse: Number.NaN },
    });
    expect(parsed?.factors).toEqual({ gap: 0.5 });
  });

  it("defaults an unknown recommendation to the most cautious one", () => {
    expect(parseRallyEnded({ ...RALLY_END, recommendation: "definitely" })?.recommendation).toBe(
      "ask",
    );
  });
});

describe("the confidence ceiling", () => {
  it("clamps a confidence that exceeds the measured oracle accuracy", () => {
    // If a future native change ever sends 1.0, the app must still not claim
    // more certainty than 8/11 rallies of evidence supports.
    const parsed = parseRallyEnded({ ...RALLY_END, confidence: 1 });
    expect(parsed?.confidence).toBe(0.727);
  });

  it("clamps a negative confidence to zero", () => {
    expect(parseRallyEnded({ ...RALLY_END, confidence: -3 })?.confidence).toBe(0);
  });

  it("leaves a confidence inside the ceiling alone", () => {
    expect(parseRallyEnded(RALLY_END)?.confidence).toBeCloseTo(0.41, 5);
  });
});

describe("track bindings", () => {
  it("maps tracker identities onto referee sides", () => {
    expect(sideForTrack("A", DEFAULT_TRACK_BINDING)).toBe("A");
    expect(sideForTrack("B", DEFAULT_TRACK_BINDING)).toBe("B");
  });

  it("flips both identities at once, so a binding is never half-swapped", () => {
    const flipped = flipBinding(DEFAULT_TRACK_BINDING);
    expect(sideForTrack("A", flipped)).toBe("B");
    expect(sideForTrack("B", flipped)).toBe("A");
    expect(flipBinding(flipped)).toEqual(DEFAULT_TRACK_BINDING);
  });
});

describe("toProposal", () => {
  it("expresses the proposal in the referee's terms", () => {
    const parsed = parseRallyEnded(RALLY_END);
    expect(parsed).not.toBeNull();
    const proposal = toProposal(parsed!, DEFAULT_TRACK_BINDING, 1000);
    expect(proposal.winner).toBe("B");
    expect(proposal.recommendation).toBe("ask");
    expect(proposal.at).toBe(1000);
    expect(proposal.why).toContain("Player B struck last");
  });

  it("follows the binding when the human has swapped the players", () => {
    const parsed = parseRallyEnded(RALLY_END)!;
    expect(toProposal(parsed, flipBinding(DEFAULT_TRACK_BINDING), 0).winner).toBe("A");
  });

  it("carries a null winner through rather than inventing one", () => {
    const parsed = parseRallyEnded({ ...RALLY_END, proposedWinner: null })!;
    expect(toProposal(parsed, DEFAULT_TRACK_BINDING, 0).winner).toBeNull();
  });
});
