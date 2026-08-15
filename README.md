# RacquetAI

Record your racquet-sport matches (tennis / pickleball / badminton) and let AI keep the score.
iOS-first React Native app built on Expo SDK 57.

## Quickstart

Prerequisites:

- Node 22+ and npm 10+ (repo is developed on Node 25)
- Xcode 16+ with an iOS 18 simulator (macOS) for `npm run ios`
- Watchman recommended on macOS: `brew install watchman`

```bash
npm install
npx expo start        # Metro + QR code; press i for iOS simulator
```

Run on a specific target:

```bash
npm run ios           # build the dev client + launch the iOS simulator
npm run android       # same for Android (emulator or device)
npm run web           # browser preview (layout checks only — no camera)
```

The native `ios/` and `android/` folders are generated, not committed (`npx expo prebuild`
runs implicitly via `expo run:*`) — see docs/06-decisions.md ADR-004.

**Camera work needs a physical device** — simulators have no camera (docs/05-testing.md).
Plug in an iPhone and `npm run ios -- --device`, or use a development build via EAS.

## Checks

```bash
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # eslint via expo lint
npm test              # jest (jest-expo preset)
```

All three must be green before a commit lands on main.

## Layout

- `src/app/` — expo-router routes: 4 tabs (Record, Library, Score AI, Settings). Routes stay
  thin; they compose feature components only.
- `src/components/` — shared primitives (Screen, ScreenHeader, Button, Card, EmptyState,
  LoadingState, ErrorBoundary, Segmented, ComingSoon).
- `src/features/<name>/` — one folder per feature; see each folder's README for ownership.
- `src/theme/` — design tokens (all colours live here; components never hardcode colours)
  and iPad layout caps.
- `src/lib/` — pure helpers (formatting, haptics, keyboard inset) with unit tests.
- `docs/` — architecture, testing, ADRs, and plans.
- `assets/brand/` — placeholder solid-colour art until real branding lands
  (`node scripts/generate-placeholder-assets.js` regenerates them).

## Docs

Start with [docs/01-architecture.md](docs/01-architecture.md), then the ADRs in
[docs/06-decisions.md](docs/06-decisions.md).
