/**
 * expo-video, faked for jest.
 *
 * It has to exist before any test can even IMPORT a screen that plays video:
 * requiring the real module under this repo's jest config throws while its
 * exports are being read (its native half is not in the test host), so a
 * missing mock does not fail an assertion — it fails at module load with an
 * opaque prototype error, before a single test runs.
 *
 * Root `__mocks__` adjacent to node_modules is applied automatically for a
 * node_modules package, with no `jest.mock("expo-video")` call needed.
 *
 * The fake player is a real event emitter in the shape `useEventListener`
 * expects — `addListener(name, cb)` returning `{ remove() }` — because that is
 * how a test drives the playhead: capture the "timeUpdate" listener and call
 * it with a time. Its properties are plain and mutable so a test can assert
 * what the screen set (volume while ducking, the mixing mode, the tick
 * interval) rather than mocking setters.
 */
type Listener = (payload: unknown) => void;

export interface FakeVideoPlayer {
  loop: boolean;
  muted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
  timeUpdateEventInterval: number;
  audioMixingMode: string;
  play: jest.Mock;
  pause: jest.Mock;
  replay: jest.Mock;
  seekBy: jest.Mock;
  release: jest.Mock;
  addListener: (name: string, callback: Listener) => { remove: () => void };
  /** Test hook: deliver an event to every listener registered for `name`. */
  __emit: (name: string, payload: unknown) => void;
  /** Test hook: how many listeners are attached, to catch leaks on unmount. */
  __listenerCount: (name: string) => number;
  /** Test hook: the source this player was created with. */
  __source: unknown;
}

/** Every player created this run, newest last — tests reach for `.at(-1)`. */
export const __players: FakeVideoPlayer[] = [];

export function __resetPlayers(): void {
  __players.length = 0;
}

function createPlayer(source: unknown): FakeVideoPlayer {
  const listeners = new Map<string, Set<Listener>>();
  const player: FakeVideoPlayer = {
    loop: false,
    muted: false,
    volume: 1,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    timeUpdateEventInterval: 0,
    audioMixingMode: "auto",
    play: jest.fn(),
    pause: jest.fn(),
    replay: jest.fn(),
    seekBy: jest.fn(),
    release: jest.fn(),
    addListener(name: string, callback: Listener) {
      const set = listeners.get(name) ?? new Set<Listener>();
      set.add(callback);
      listeners.set(name, set);
      return {
        remove: () => {
          set.delete(callback);
        },
      };
    },
    __emit(name: string, payload: unknown) {
      for (const callback of listeners.get(name) ?? []) callback(payload);
    },
    __listenerCount(name: string) {
      return listeners.get(name)?.size ?? 0;
    },
    __source: source,
  };
  return player;
}

/**
 * The real hook creates the player once per source and runs `setup` on it. The
 * fake does the same, keyed on the source, so a re-render does not hand the
 * screen a different player and silently drop its listeners.
 */
export function useVideoPlayer(
  source: unknown,
  setup?: (player: FakeVideoPlayer) => void,
): FakeVideoPlayer {
  const key = JSON.stringify(source ?? null);
  const existing = __players.find((player) => JSON.stringify(player.__source ?? null) === key);
  if (existing !== undefined) return existing;
  const player = createPlayer(source);
  setup?.(player);
  __players.push(player);
  return player;
}

/** Rendered as a host component the test renderer can find by type. */
export const VideoView = "VideoView";

export const isPictureInPictureSupported = (): boolean => false;
export const createVideoPlayer = (source: unknown): FakeVideoPlayer => createPlayer(source);
