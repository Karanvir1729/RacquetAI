/**
 * The live-watching half of the Score keeper: owns the native capture session
 * and turns its event stream into "there is a question on screen".
 *
 * ---------------------------------------------------------------------------
 * IT CANNOT SCORE. NOT BY DESIGN CHOICE — BY CONSTRUCTION.
 * ---------------------------------------------------------------------------
 * Nothing in this file touches the match. It never calls `awardRally`, never
 * builds a `ScoreEvent`, and has no reference to `useRefereeMatch`. The only
 * thing it produces is a `RallyProposal`, which is a question. A human tapping
 * a rally button is the sole path from "the camera saw something" to "the score
 * changed", and there is no timer anywhere in this file that could shortcut it.
 *
 * Everything else here is about not being a liability courtside:
 * - the whole native surface is loaded through liveClient's guarded loaders, so
 *   a binary without the Swift half degrades to `available: false` and the
 *   screen simply never offers to watch (six TestFlight builds died on a native
 *   module that threw while its exports were being READ);
 * - the camera is released on stop, on unmount, and when the app is
 *   backgrounded — a 45-minute match must not become a 45-minute camera leak;
 * - the screen is kept awake only while actually watching.
 *
 * On the ~300-line file guideline (docs/01 rule 5): this is ~230 lines of code
 * and it stays whole deliberately. Every path that can leave the camera running
 * — stop, unmount, background, a start that lost its race with an unmount — has
 * to be visible in one place next to the state it releases. Splitting the
 * lifecycle across files is exactly how one of those paths goes quietly
 * missing, and the failure is a phone that gets hot in somebody's bag.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Dimensions, StyleProp, ViewStyle } from "react-native";

import {
  DEFAULT_TRACK_BINDING,
  flipBinding,
  livePreviewComponent,
  liveRefereePermissions,
  loadLiveReferee,
  refreshLiveOrientation,
  requestLivePermissions,
  startLiveReferee,
  stopLiveReferee,
  subscribeLiveReferee,
  toProposal,
  type LiveRallyEnded,
  type LiveSessionProblem,
  type LiveStatus,
  type RallyProposal,
  type TrackBinding,
} from "./liveClient";

/** The native preview view. Props are the module's `LivePreviewProps`. */
export type LivePreview = ComponentType<{
  gravity?: "cover" | "contain";
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Why watching is not running, and whether the fix is in iOS Settings. Denied
 * permissions are the one case the app cannot re-prompt for, so the banner has
 * to hand over a way there.
 */
export interface LiveNotice {
  text: string;
  canOpenSettings: boolean;
}

export interface LiveWatch {
  /** This binary has both the session and the preview view. */
  available: boolean;
  /** The session is running and the screen should show the court. */
  watching: boolean;
  starting: boolean;
  status: LiveStatus | null;
  /** Why watching is not available right now — shown on the manual layout. */
  notice: LiveNotice | null;
  dismissNotice: () => void;
  /** Which tracker identity is which player; the tracker cannot know. */
  binding: TrackBinding;
  swapBinding: () => void;
  /** The open question, or null. Never becomes a point on its own. */
  proposal: RallyProposal | null;
  /** A shot landed after the question was asked — they played on. */
  playResumed: boolean;
  /** Shots detected so far in the rally in play, or null between rallies. */
  rallyStrikes: number | null;
  Preview: LivePreview | null;
  start: () => void;
  stop: () => void;
  clearProposal: () => void;
}

const KEEP_AWAKE_TAG = "racquetiq-referee-watch";

/**
 * What to tell someone whose camera did not start. Every one of these ends the
 * same way, because it is the only thing that matters: the tap-driven referee
 * is still right there.
 */
function problemNotice(problem: LiveSessionProblem | null): LiveNotice {
  switch (problem) {
    case "camera-denied":
      return {
        text: "Camera access is off, so it cannot watch the court. Scoring by tap works either way.",
        canOpenSettings: true,
      };
    case "microphone-denied":
      return {
        text: "Microphone access is off. Shots are found by sound, so there would be nothing to watch for. Scoring by tap works either way.",
        canOpenSettings: true,
      };
    case "no-camera":
      return {
        text: "No usable camera on this device — the Simulator has none. Score by tapping.",
        canOpenSettings: false,
      };
    case "interrupted":
      return {
        text: "Something else took the camera. Score by tapping, or try watching again.",
        canOpenSettings: false,
      };
    default:
      return { text: "The camera could not be started. Score by tapping.", canOpenSettings: false };
  }
}

export function useLiveReferee(): LiveWatch {
  // Resolved exactly once, in a lazy initializer rather than useMemo: loading a
  // native module is a side effect, and useMemo is explicitly allowed to re-run.
  const [native] = useState(() => {
    const module = loadLiveReferee();
    return { module, preview: livePreviewComponent(module) as LivePreview | null };
  });
  const available = native.module !== null && native.preview !== null;

  const [watching, setWatching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [notice, setNotice] = useState<LiveNotice | null>(null);
  const [binding, setBinding] = useState<TrackBinding>(DEFAULT_TRACK_BINDING);
  const [rallyStrikes, setRallyStrikes] = useState<number | null>(null);
  // The RAW event, not the resolved proposal: swapping the binding while a
  // question is on screen has to correct that question, not just the next one.
  const [rallyEnd, setRallyEnd] = useState<{ event: LiveRallyEnded; at: number } | null>(null);
  /** When play was last seen. Compared against the question's own timestamp. */
  const [lastPlayAt, setLastPlayAt] = useState(0);

  // Refs mirror the state the event callbacks and the AppState listener read.
  // Those fire from outside React's render, so a closure over state would be
  // reading whatever was current when the listener was installed.
  const mounted = useRef(true);
  const watchingRef = useRef(false);
  const wantsRef = useRef(false);
  const launchingRef = useRef(false);

  const setWatchingBoth = useCallback((next: boolean) => {
    watchingRef.current = next;
    setWatching(next);
  }, []);

  const clearProposal = useCallback(() => setRallyEnd(null), []);

  // One subscription for the life of the screen. Subscribing costs nothing
  // while nothing is running, and installing it up front means a session that
  // starts fast cannot deliver its first event into a void.
  useEffect(() => {
    if (native.module === null) return;
    const unsubscribe = subscribeLiveReferee(
      {
        onStatus: (next) => {
          setStatus(next);
          // The session died under us (interruption, a permission revoked in
          // Settings mid-match). Fall back rather than leave a frozen preview.
          if (next.state === "failed" && watchingRef.current) {
            wantsRef.current = false;
            setWatchingBoth(false);
            setNotice(problemNotice(next.problem));
          }
        },
        onRallyStarted: () => {
          if (!watchingRef.current) return;
          setRallyStrikes(1);
          setLastPlayAt(Date.now());
        },
        onStrike: (event) => {
          if (!watchingRef.current) return;
          setRallyStrikes(event.indexInRally);
          setLastPlayAt(Date.now());
        },
        onRallyEnded: (event) => {
          if (!watchingRef.current) return;
          setRallyStrikes(null);
          // The newest question replaces any older one. Answering a
          // three-rallies-ago question would be worse than missing it: the
          // human answers about what they just watched, so that is what the
          // screen has to be asking about.
          setRallyEnd({ event, at: Date.now() });
        },
      },
      native.module,
    );
    return unsubscribe;
  }, [native.module, setWatchingBoth]);

  const proposal = useMemo<RallyProposal | null>(
    () => (rallyEnd === null ? null : toProposal(rallyEnd.event, binding, rallyEnd.at)),
    [rallyEnd, binding],
  );
  // Derived, not stored: "a shot landed after the question was asked" is a
  // comparison of two timestamps the screen already has, and holding it as its
  // own piece of state would mean a ref written during render.
  const playResumed = rallyEnd !== null && lastPlayAt > rallyEnd.at;

  /**
   * Bring the session up. Shared by the first start and the foreground resume,
   * and re-entrant-safe: coming back to the foreground while a start is still
   * in flight must not open a second capture session.
   */
  const launch = useCallback(async () => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    try {
      const next = await startLiveReferee({}, native.module);
      if (!mounted.current) {
        // Unmounted mid-start: the effect's cleanup already asked it to stop,
        // but it had not started yet, so ask again or the camera stays on.
        void stopLiveReferee(native.module);
        return;
      }
      setStatus(next);
      setStarting(false);
      if (next.state === "running") {
        setWatchingBoth(true);
        void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
        return;
      }
      wantsRef.current = false;
      setWatchingBoth(false);
      setNotice(problemNotice(next.problem));
    } finally {
      launchingRef.current = false;
    }
  }, [native.module, setWatchingBoth]);

  const start = useCallback(() => {
    if (!available || watchingRef.current || wantsRef.current) return;
    wantsRef.current = true;
    setNotice(null);
    setStarting(true);
    void (async () => {
      const current = liveRefereePermissions(native.module);
      // Only prompt for what has never been asked. A prior denial must go to
      // Settings; re-requesting it is a no-op that looks like a broken button.
      if (current.camera === "undetermined" || current.microphone === "undetermined") {
        await requestLivePermissions(native.module);
      }
      if (!mounted.current || !wantsRef.current) {
        setStarting(false);
        return;
      }
      await launch();
    })();
  }, [available, launch, native.module]);

  const stop = useCallback(() => {
    wantsRef.current = false;
    setWatchingBoth(false);
    setStarting(false);
    setRallyStrikes(null);
    clearProposal();
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    void stopLiveReferee(native.module);
  }, [clearProposal, native.module, setWatchingBoth]);

  // The safety net. Leaving the screen — back, a tab switch, a JS reload —
  // must always release the camera, whatever state the session was in.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      wantsRef.current = false;
      watchingRef.current = false;
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      void stopLiveReferee(native.module);
    };
  }, [native.module]);

  // Backgrounding releases the camera and resumes on return. "inactive" is NOT
  // backgrounded — it fires for a permission alert or a Control Centre pull,
  // and tearing the session down for those would kill it as it starts.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (!wantsRef.current) return;
      if (next === "background") {
        setWatchingBoth(false);
        void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
        void stopLiveReferee(native.module);
        return;
      }
      if (next === "active" && !watchingRef.current) void launch();
    });
    return () => subscription.remove();
  }, [launch, native.module, setWatchingBoth]);

  // The capture connection is rotated natively; it only needs telling when the
  // device turns (iPad — the phone layout is portrait-locked).
  useEffect(() => {
    if (!watching) return;
    const subscription = Dimensions.addEventListener("change", () =>
      refreshLiveOrientation(native.module),
    );
    return () => subscription.remove();
  }, [native.module, watching]);

  const swapBinding = useCallback(() => setBinding(flipBinding), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    available,
    watching,
    starting,
    status,
    notice,
    dismissNotice,
    binding,
    swapBinding,
    proposal,
    playResumed,
    rallyStrikes,
    Preview: native.preview,
    start,
    stop,
    clearProposal,
  };
}
