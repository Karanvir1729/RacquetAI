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
import { ANNOUNCE_OPTIONS, createAnnouncer, loadSpeech, SpeechModule } from "../speech";

function fakeModule(): SpeechModule & { spoken: string[]; stops: number; calls: string[] } {
  const spoken: string[] = [];
  const calls: string[] = [];
  return {
    spoken,
    calls,
    stops: 0,
    speak(text: string) {
      spoken.push(text);
      calls.push(`speak:${text}`);
    },
    stop() {
      this.stops += 1;
      calls.push("stop");
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
    expect(speak).toHaveBeenCalledWith("Eight all.", ANNOUNCE_OPTIONS);
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
