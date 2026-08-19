/**
 * Speech is never load-bearing. These tests are the guarantee: a missing
 * module, a module with the wrong shape, or a module that throws all leave a
 * working (silent) scoreboard, and a burst of taps speaks the latest score
 * rather than a backlog of stale ones.
 *
 * This app shipped six crashing TestFlight builds from a native module that
 * threw at import time, which is why loadSpeech is tested against a loader
 * that throws.
 */
import {
  ANNOUNCE_OPTIONS,
  createAnnouncer,
  loadSpeech,
  SpeechModule,
  SpeechOptions,
} from "../speech";

interface FakeModule extends SpeechModule {
  spoken: string[];
  stops: number;
  calls: string[];
  /** Deliver the native `onDone` for the line in flight, as iOS would. */
  finish(): void;
}

function fakeModule(): FakeModule {
  const spoken: string[] = [];
  const calls: string[] = [];
  let pending: SpeechOptions | undefined;
  return {
    spoken,
    calls,
    stops: 0,
    speak(text: string, options?: SpeechOptions) {
      spoken.push(text);
      calls.push(`speak:${text}`);
      pending = options;
    },
    stop() {
      this.stops += 1;
      calls.push("stop");
    },
    finish() {
      const done = pending?.onDone;
      pending = undefined;
      done?.();
    },
  };
}

describe("loadSpeech", () => {
  it("returns null when the module throws while being loaded", () => {
    expect(
      loadSpeech(() => {
        throw new Error("native module RNSpeech not found");
      }),
    ).toBeNull();
  });

  it("returns null when reading the export throws (a lazy native getter)", () => {
    const booby = {};
    Object.defineProperty(booby, "default", {
      get() {
        throw new Error("bridge unavailable");
      },
    });
    expect(loadSpeech(() => booby)).toBeNull();
  });

  it("returns null for a module missing the functions we call", () => {
    expect(loadSpeech(() => ({ speak: () => {} }))).toBeNull();
    expect(loadSpeech(() => ({ stop: () => {} }))).toBeNull();
    expect(loadSpeech(() => null)).toBeNull();
    expect(loadSpeech(() => "expo-speech")).toBeNull();
  });

  it("accepts the module namespace (how expo-speech actually exports)", () => {
    const module = fakeModule();
    expect(loadSpeech(() => module)).toBe(module);
  });

  it("accepts a default export too", () => {
    const module = fakeModule();
    expect(loadSpeech(() => ({ default: module }))).toBe(module);
  });
});

describe("createAnnouncer without a speech module", () => {
  const announcer = createAnnouncer(null);

  it("reports itself unavailable so the UI can hide the mute toggle", () => {
    expect(announcer.available).toBe(false);
  });

  it("keeps scoring silently instead of throwing", () => {
    expect(() => announcer.say("Ten, three. Game ball.")).not.toThrow();
    expect(() => announcer.stop()).not.toThrow();
  });
});

describe("createAnnouncer with a speech module", () => {
  it("speaks the line with the courtside voice settings", () => {
    const module = fakeModule();
    const speak = jest.spyOn(module, "speak");
    createAnnouncer(module).say("Eight all.");
    // The voice settings, plus the lifecycle callbacks that let a caller duck
    // other audio for the length of the line (see SpeechWatcher).
    expect(speak).toHaveBeenCalledWith("Eight all.", expect.objectContaining(ANNOUNCE_OPTIONS));
    const [, options] = speak.mock.calls[0] ?? [];
    expect(typeof options?.onDone).toBe("function");
    expect(typeof options?.onStopped).toBe("function");
    expect(typeof options?.onError).toBe("function");
  });

  it("cancels the sentence in flight before starting the next one", () => {
    const module = fakeModule();
    createAnnouncer(module).say("Eight all.");
    expect(module.calls).toEqual(["stop", "speak:Eight all."]);
  });

  it("speaks the LATEST score on a burst of taps, never a backlog", () => {
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    announcer.say("One, love.");
    announcer.say("Two, love.");
    announcer.say("Three, love.");
    // Three stops for three lines: each one pre-empts the last, so the voice
    // is only ever mid-way through the newest score.
    expect(module.stops).toBe(3);
    expect(module.calls[module.calls.length - 1]).toBe("speak:Three, love.");
  });

  it("ignores an empty line rather than clearing its throat", () => {
    const module = fakeModule();
    createAnnouncer(module).say("");
    expect(module.calls).toEqual([]);
  });

  it("swallows a failure inside the speech engine", () => {
    const module: SpeechModule = {
      speak() {
        throw new Error("AVSpeechSynthesizer failed");
      },
      stop() {
        throw new Error("AVSpeechSynthesizer failed");
      },
    };
    const announcer = createAnnouncer(module);
    expect(announcer.available).toBe(true);
    expect(() => announcer.say("Match ball.")).not.toThrow();
    expect(() => announcer.stop()).not.toThrow();
  });
});

/**
 * The watcher exists so the video-playback screen can duck the match audio
 * under a call. Its whole contract is BALANCE: a caller that turns the volume
 * down on `onStart` and back up on `onEnd` must never be left with a silent
 * video, whatever expo-speech does or fails to do.
 */
describe("the speech watcher", () => {
  const events: string[] = [];
  const watcher = { onStart: () => events.push("start"), onEnd: () => events.push("end") };

  beforeEach(() => {
    events.length = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("brackets a spoken line", () => {
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    announcer.watch(watcher);
    announcer.say("Eight all.");
    expect(events).toEqual(["start"]);
    module.finish();
    expect(events).toEqual(["start", "end"]);
  });

  it("does not blip between two lines in a row", () => {
    // The second call REPLACES the first, so the duck continues. Ending and
    // restarting would raise the video's volume for a frame between two calls.
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    announcer.watch(watcher);
    announcer.say("Eight all.");
    announcer.say("Nine, eight.");
    expect(events).toEqual(["start"]);
    module.finish();
    expect(events).toEqual(["start", "end"]);
  });

  it("ends when speech is stopped, not just when it finishes", () => {
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    announcer.watch(watcher);
    announcer.say("Eight all.");
    announcer.stop();
    expect(events).toEqual(["start", "end"]);
  });

  it("ends even when the module never calls back at all", () => {
    // A synthesiser killed by an audio interruption delivers nothing. Without
    // the guard timer the video would stay ducked for the rest of the match.
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    announcer.watch(watcher);
    announcer.say("Eight all.");
    expect(events).toEqual(["start"]);
    jest.advanceTimersByTime(60_000);
    expect(events).toEqual(["start", "end"]);
  });

  it("ends when the module throws mid-line", () => {
    const module = fakeModule();
    module.speak = () => {
      throw new Error("no synthesiser");
    };
    const announcer = createAnnouncer(module);
    announcer.watch(watcher);
    announcer.say("Eight all.");
    expect(events).toEqual(["start", "end"]);
  });

  it("tells a watcher installed mid-line that the voice is already going", () => {
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    announcer.say("Eight all.");
    announcer.watch(watcher);
    // Otherwise it would sit waiting for an `onEnd` whose `onStart` it missed,
    // and duck nothing while restoring something.
    expect(events).toEqual(["start"]);
    module.finish();
    expect(events).toEqual(["start", "end"]);
  });

  it("stops calling back once unwatched", () => {
    const module = fakeModule();
    const announcer = createAnnouncer(module);
    const unwatch = announcer.watch(watcher);
    unwatch();
    announcer.say("Eight all.");
    module.finish();
    expect(events).toEqual([]);
  });

  it("is a no-op on a build with no speech module", () => {
    const announcer = createAnnouncer(null);
    const unwatch = announcer.watch(watcher);
    announcer.say("Eight all.");
    unwatch();
    expect(events).toEqual([]);
  });
});
