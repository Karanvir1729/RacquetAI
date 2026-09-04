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
  /**
   * Lifecycle callbacks. Only the Referee's video playback needs them, and it
   * needs them for one reason: on iOS the video's own audio and the spoken
   * call go into the SAME audio session and sum at full volume, so a call made
   * over a squash rally is inaudible under the ball strikes. Knowing when a
   * line starts and stops is what lets the caller duck the video under it.
   */
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
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

/**
 * Put the process on an audio category that ignores the ring/silent switch.
 *
 * Without this the app is SILENT on any phone carried to a club on silent —
 * the one place this feature is used — while still drawing an unmuted speaker
 * icon. The category is process-wide and sticky, so once per launch is enough;
 * we run it lazily on the first speak rather than at import time so a build
 * without the native module simply carries on mute-but-working.
 *
 * Entirely best-effort. Never throws, never blocks a call.
 */
let audioSessionReady = false;
function ensureAudioSession(): void {
  if (audioSessionReady) return;
  audioSessionReady = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require("racquet-analyzer") as unknown;
    if (isRecord(native) && typeof native.configureAudioSessionForSpeech === "function") {
      (native.configureAudioSessionForSpeech as () => boolean)();
    }
  } catch {
    // No native module in this binary (Expo Go, a stripped build): the app
    // still scores, it is just subject to the silent switch.
  }
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

/**
 * Told when the voice starts and stops, so a caller can get out of its way.
 *
 * Guaranteed to be balanced: every `onStart` is followed by exactly one
 * `onEnd`, whatever expo-speech does — including when the line is cancelled by
 * the next one, when the module throws, and when its callbacks never fire at
 * all. A caller that ducks audio on start and restores it on end must never be
 * left holding a permanently quiet video.
 */
export interface SpeechWatcher {
  onStart: () => void;
  onEnd: () => void;
}

export interface Announcer {
  /** False when expo-speech is missing — the UI hides the mute toggle. */
  readonly available: boolean;
  /** Speak a line, replacing anything still being spoken. */
  say(text: string): void;
  /** Cut speech off (leaving the screen, muting, starting a new match). */
  stop(): void;
  /**
   * Watch the voice. Returns an unsubscribe. At most one watcher is needed
   * (one screen plays video at a time), so a second call replaces the first
   * rather than accumulating listeners nobody removes.
   */
  watch(watcher: SpeechWatcher): () => void;
}

/** An announcer that does nothing, for a build without expo-speech. */
const SILENT: Announcer = {
  available: false,
  say: () => {},
  stop: () => {},
  watch: () => () => {},
};

/**
 * How long a line may hold the duck before it is force-released.
 *
 * The belt to the callbacks' braces. `onDone` is delivered by the native
 * synthesiser, and a build where it never arrives — a module that throws
 * mid-utterance, a synthesiser killed by an audio interruption — would
 * otherwise leave the video muted for the rest of the match with no way for
 * the user to work out why. Comfortably longer than the longest call this app
 * makes ("Game ball. Hand out. Ten, eight." is about three seconds).
 */
const MAX_UTTERANCE_MS = 8000;

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

  let watcher: SpeechWatcher | null = null;
  // Whether the caller currently believes the voice is speaking. All the
  // balancing logic hangs off this one flag rather than off the callbacks,
  // which are the part that can go missing.
  let speaking = false;
  let guard: ReturnType<typeof setTimeout> | null = null;

  const end = () => {
    if (guard !== null) {
      clearTimeout(guard);
      guard = null;
    }
    if (!speaking) return;
    speaking = false;
    watcher?.onEnd();
  };

  const begin = () => {
    // A new line while one is in flight is a REPLACEMENT, not a second speaker
    // — so the duck simply continues rather than ending and restarting, which
    // would blip the video's volume up for a frame between two calls.
    if (guard !== null) clearTimeout(guard);
    guard = setTimeout(end, MAX_UTTERANCE_MS);
    if (speaking) return;
    speaking = true;
    watcher?.onStart();
  };

  return {
    available: true,
    say(text: string) {
      if (text.length === 0) return;
      try {
        // Before the first word, not at import: see ensureAudioSession.
        ensureAudioSession();
        module.stop();
        begin();
        module.speak(text, {
          ...ANNOUNCE_OPTIONS,
          // Every terminal callback lands on the same `end`, and `end` is
          // idempotent: expo-speech delivers exactly one of done/stopped/error
          // per utterance on iOS, but a platform that delivers two — or none,
          // hence the guard timer — must still balance.
          onDone: end,
          onStopped: end,
          onError: end,
        });
      } catch {
        // A failed announcement must never interrupt scoring — and must never
        // leave the caller ducked for a line that was never spoken.
        end();
      }
    },
    stop() {
      try {
        module.stop();
      } catch {
        // Nothing to do — worst case a sentence finishes on its own.
      }
      // Not conditional on the module call succeeding: `stop` is what runs when
      // the screen goes away, and the duck must be released either way.
      end();
    },
    watch(next: SpeechWatcher) {
      watcher = next;
      // A watcher installed while a line is already in flight is told at once,
      // or it would wait for an `onEnd` whose `onStart` it never heard.
      if (speaking) next.onStart();
      return () => {
        if (watcher === next) watcher = null;
      };
    },
  };
}
