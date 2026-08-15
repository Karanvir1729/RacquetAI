# 01 — Architecture

## What this app is

An iOS-first Expo (React Native) app for racquet sports. v0 records match videos on-device;
the next phase adds AI score tracking over that footage. Android ships from the same codebase
but iOS is the release train.

## App structure

```
src/
  app/            expo-router file-based routes — the 4-tab shell
    _layout.tsx   root: ErrorBoundary > GestureHandlerRootView > SafeAreaProvider > Tabs
    index.tsx     Record tab (camera capture)     — owned by features/recording
    library.tsx   Library tab (playback)          — owned by features/recording
    score.tsx     Score AI tab                    — owned by features/scoring
    settings.tsx  Settings (about/links/licenses) — baseline-owned
  components/     shared UI primitives, tokens-only styling
  features/       one folder per feature: components, hooks, helpers
  lib/            pure helpers (format, haptics, keyboard inset) + unit tests
  theme/          tokens.ts (colours/spacing/type) and layout.ts (iPad column caps)
```

Rules (inherited from the predecessor app's coding principles, which they kept honest at scale):

1. **Routes are thin.** Files under `src/app/` only compose feature components and wire
   navigation. No business logic, no direct media/API calls in route files.
2. **One folder per feature** under `src/features/<name>/`. A feature may import from
   `src/components`, `src/lib`, `src/theme` — never from another feature's internals; shared
   things get promoted to `src/components` or `src/lib`.
3. **Every colour is a token.** `src/theme/tokens.ts` is the single palette; components never
   hardcode colours. This is what lets the branding pass swap the palette in one file.
4. **Client state lives in zustand** (recording session state, UI prefs). Server state gets
   TanStack Query if/when a backend appears — do not hand-roll caches.
5. **Hard size limits:** a file over ~300 lines or a component over ~150 lines needs a split
   or a comment justifying why splitting would hurt.
6. Strict TypeScript, no `any` (use `unknown` + narrowing at boundaries).

## Data flow (v0)

Everything is on-device; there is no backend yet.

```
CameraView (expo-camera)
   └─ recorded file ──> app sandbox (expo-file-system)
                          ├─> optional export to Photos (expo-media-library)
                          └─> Library list ──> playback (expo-video)
Score AI (later) ──> reads recordings from the sandbox, emits score timelines
```

Recording metadata (duration, sport, date, court) will live in a small on-device store
(zustand + persisted JSON) until scoring needs richer storage.

## Why Expo managed + CNG, with `ios/` gitignored

The app uses the managed workflow with Continuous Native Generation: `ios/` and `android/`
are build artifacts produced by `expo prebuild` (implicitly via `expo run:*` or EAS), never
committed. All native configuration lives in `app.json` (permissions strings, plugins,
orientation, bundle ids), so a native-project drift bug can't exist — the native projects are
regenerated from config every time. See ADR-003 (expo-camera fits managed) and ADR-004
(the predecessor app committed `ios/` and paid for it in noise; we don't).

Costs we accept: custom native code requires a config plugin or a dev build, and any tool that
wants to edit the Xcode project directly is off the table. For a camera + playback app on
Expo SDK capabilities, nothing in scope needs that.

## Navigation

expo-router v57 with typed routes. Four tabs, no auth stack (v0 has no accounts). Deep links
use the `racquetai` scheme. New screens = new files under `src/app/`; modals and the future
player screen mount as stack screens above the tabs when they land.

## Theming

`tokens.ts` colours are dark/light `DynamicColorIOS` pairs resolved natively by iOS
(`userInterfaceStyle: "automatic"`); Android pins the dark palette until an Appearance-listener
pass. Module-scope `StyleSheet.create` keeps working and there is no theme provider or
re-render cost. iPad readability comes from `layout.ts` centred-column caps (ADR-002).
