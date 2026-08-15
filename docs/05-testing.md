# 05 — Testing

## The three checks

```bash
npm run typecheck   # tsc --noEmit — strict mode, catches contract drift
npm run lint        # expo lint (eslint-config-expo flat config)
npm test            # jest with the jest-expo preset
```

All three must be green before a commit lands on `main`. Worktree branches run the same three
before merging back.

Unit tests live in `src/lib/__tests__/` (and later `src/features/**/__tests__/`), matched by
`**/__tests__/**/*.test.ts`. Pure helpers (formatting, future score-rule models) carry tests;
UI screens are verified on a simulator/device instead — snapshot tests of styled RN trees have
historically cost more than they catch.

## Simulator vs physical device

**The iOS simulator has no camera.** `expo-camera` renders a black preview and cannot record.
That splits verification into two tiers:

| What changed | Where to verify |
|---|---|
| Layout, navigation, Settings, Library list, theming | iOS simulator is fine |
| Anything touching capture: preview, record/stop, torch, save-to-library | **physical iPhone required** |
| Playback of an existing file | simulator works (bundle a fixture or AirDrop a video) |

Physical-device run: plug the iPhone in, trust the Mac, then

```bash
npm run ios -- --device
```

or install a development build via EAS (`eas build --profile development`) and connect to the
same Metro instance.

The rule inherited from the predecessor app, kept deliberately: **a feature is "done" only
after it has been exercised on a real device (or simulator, for tier-1 changes) — not when the
checks pass.** Log what was actually tried in the PR/commit description.

## iPad

`ios.supportsTablet` is true (ADR-002), so every UI change gets a quick pass on an iPad
simulator too — worst case is the exact guideline-4 rejection that motivated the ADR. The
centred-column caps in `src/theme/layout.ts` do the heavy lifting; verify new screens actually
use `Screen`/`column()` instead of stretching edge-to-edge.

## What CI runs (when CI exists)

The same three commands, on a clean checkout, Node 22. No device farm — physical testing stays
a human step in this repo.
