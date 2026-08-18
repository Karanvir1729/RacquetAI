/**
 * The speaking half of the Score keeper — a defensive wrapper around
 * expo-speech.
 *
 * expo-speech is loaded with `require` inside try/catch, NEVER a top-level
 * static import, and the WHOLE body is guarded: a module whose native half is
 * missing from the binary can throw while its exports are merely being read,
 * not just when they are called. This app shipped six crashing TestFlight
 * builds from exactly that (see features/analysis/deviceClient.ts, same
 * pattern) — a silent scoreboard is a minor disappointment, a scoreboard that
 * crashes mid-match is the end of the match.
 *
 * So: speech is never load-bearing. Every call is best-effort, every failure
 * is swallowed, and `available` tells the UI whether to offer the toggle at
 * all. Scoring works identically with the module missing.
 */

/** The slice of expo-speech this feature uses. */
export interface SpeechOptions {
  language?: string;
  rate?: number;
  pitch?: number;
}

export interface SpeechModule {
  speak(text: string, options?: SpeechOptions): void;
  stop(): void;
}

export type SpeechLoader = () => unknown;

// Must be a runtime require inside try/catch — see the file comment.
const defaultLoader: SpeechLoader = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("expo-speech") as unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function narrowModule(value: unknown): SpeechModule | null {
  if (!isRecord(value)) return null;
  return typeof value.speak === "function" && typeof value.stop === "function"
    ? (value as unknown as SpeechModule)
    : null;
}

/**
 * expo-speech, or null when it cannot be loaded or does not expose the two
 * functions we need. Accepts either the module namespace or a default export.
 * Never throws.
 */
export function loadSpeech(loader: SpeechLoader = defaultLoader): SpeechModule | null {
  try {
    const exported = loader();
    const viaDefault = isRecord(exported) ? narrowModule(exported.default) : null;
    return viaDefault ?? narrowModule(exported);
  } catch {
    return null;
  }
}

/**
 * Courtside voice settings. Slightly under normal pace: the whole line is four
 * or five words heard from a few metres away, over the echo of a squash court.
 */
export const ANNOUNCE_OPTIONS: SpeechOptions = { language: "en-US", rate: 0.95, pitch: 1.0 };

export interface Announcer {
  /** False when expo-speech is missing — the UI hides the mute toggle. */
  readonly available: boolean;
  /** Speak a line, replacing anything still being spoken. */
  say(text: string): void;
  /** Cut speech off (leaving the screen, muting, starting a new match). */
  stop(): void;
}

/** An announcer that does nothing, for a build without expo-speech. */
const SILENT: Announcer = {
  available: false,
  say: () => {},
  stop: () => {},
};

/**
 * Wrap a speech module into the announcer the screen uses.
 *
 * Every line CANCELS the previous one rather than queueing behind it. Three
 * quick taps during a scrappy exchange must leave the players hearing the
 * current score, not a backlog of three scores read out in sequence, the last
 * of which is the only true one.
 */
export function createAnnouncer(module: SpeechModule | null = loadSpeech()): Announcer {
  if (module === null) return SILENT;
  return {
    available: true,
    say(text: string) {
      if (text.length === 0) return;
      try {
        module.stop();
        module.speak(text, ANNOUNCE_OPTIONS);
      } catch {
        // A failed announcement must never interrupt scoring.
      }
    },
    stop() {
      try {
        module.stop();
      } catch {
        // Nothing to do — worst case a sentence finishes on its own.
      }
    },
  };
}
