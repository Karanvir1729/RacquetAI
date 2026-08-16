# features/recording

Owned by the **feat/video-recording** worktree (`.worktrees/video`). Everything about capturing,
storing, and playing back match footage lives here, plus the thin route bodies of
`src/app/index.tsx` (Record) and `src/app/library.tsx` (Library). Other branches must not edit
files in this folder or those two routes — shared primitives graduate to `src/components/` via
main.

## How a recording is stored

```
<documents>/recordings/
  rec-20260815-142312-x7k2.mov            the video (extension from the camera: .mov iOS, .mp4 Android)
  rec-20260815-142312-x7k2.json           sidecar (schema v1): { v, id, createdAt, durationSec, sport, videoName }
  rec-20260815-142312-x7k2.analysis.json  optional — analysis pipeline output (features/analysis contract)
```

The directory listing **is** the database. Each take is a video + sidecar pair sharing an id
basename (UTC timestamp + random base36 suffix — ids sort chronologically as plain strings), so
pairing needs no central index that could drift from the files. `expo-camera` records into its
cache; on stop, `storage.saveRecording` moves the file (same-volume rename) into the documents
sandbox — which iOS never purges, unlike the cache — and writes the sidecar. Listing skips
corrupt sidecars and orphans instead of failing, and delete prefix-matches `<id>.*` so even a
recording with a mangled sidecar can be fully removed. `durationSec` is wall-clock measured
around `recordAsync`, because the camera API doesn't report it.

This supersedes the docs/01 sketch of "recording metadata in a zustand persisted store": the
sidecar-per-file scheme keeps metadata attached to the footage it describes with no second
source of truth to reconcile.

## Module map

| Module | Role |
|---|---|
| `types.ts` | Domain types + sidecar schema. Pure. |
| `naming.ts` | Id + filename scheme, extension normalization. Pure — unit-tested. |
| `metadata.ts` | Sidecar (de)serialization; parsing narrows `unknown` and rejects/degrades bad fields. Pure — unit-tested. |
| `display.ts` | Deterministic "Today · 2:07 PM" labels and sport names (no `toLocale*` — Hermes/Node output must match). Pure — unit-tested. |
| `storage.ts` | expo-file-system File/Directory API: save (move + sidecar), list (newest-first), delete. |
| `useRecordings.ts` | Library list state; re-reads the store on every tab focus. |
| `RecordScreen.tsx` | CameraView capture: permission gate → camera; timer, keep-awake per take, sport tag. |
| `RecordControls.tsx` | Record button (white ring, red core, circle ↔ square morph), flip button, elapsed badge. |
| `SportChips.tsx` | Optional sport tag over the preview; squash leads, default stays "unspecified". |
| `PermissionGate.tsx` | First-use explainer → system prompts; hard denial → "Open Settings" (expo-linking); plus the no-camera state. |
| `LibraryScreen.tsx` | Newest-first list, tap → player, swipe-left or trash → confirmed delete, empty/loading/error states; View-analysis affordance on analyzed takes. |
| `PlayerModal.tsx` | Full-screen expo-video playback (`useVideoPlayer` + `VideoView`), save-to-Photos behind an explicit button. |
| `DemoAnalysisCard.tsx` | Persistent "Sample" teaser above the list — opens `/analysis?source=demo` (navigates by route; no cross-feature import). |

Since the Match Analysis feature landed, `recordingsDirectory` lives in `src/lib/recordingsDir`
(promoted so `features/analysis` can locate `<id>.analysis.json` sidecars via
`src/lib/analysisSidecar` without importing this feature's internals); `storage.ts` imports it
from there.

## Behaviour notes

- **Permissions** are requested on first use from the explainer, never at cold launch, camera
  prompt before microphone. After a hard denial the gate switches to an Open Settings path —
  iOS shows each system prompt only once.
- **Keep-awake** (`expo-keep-awake`) is held for exactly the duration of a take under a
  `"recording"` tag, released in `finally` and again on unmount.
- **Leaving the Record tab mid-take** deactivates the camera (`active` tracks tab focus), which
  ends the recording; the in-flight `recordAsync` promise resolves and the take saves normally.
- **Simulator degradation**: `onMountError` renders the explanatory no-camera state (the iOS
  Simulator has none), and a `recordAsync` rejection alerts and resets cleanly — no crash
  either way. The Library still works on the Simulator.
- **Save to Photos** (`expo-media-library` `Asset.create`) asks for write-only access and only
  runs from its button in the player; footage otherwise stays in the app sandbox.
- **Playback is a Modal, not a route**: the tab shell (`src/app/_layout.tsx`) is baseline-owned
  and a new file under `src/app/` would register as a fifth tab; a full-screen Modal owned by
  the Library keeps the player inside this feature's lane. Revisit if a stack-above-tabs
  layout lands on main.

## Testing

`__tests__/` covers the pure parts: id/filename scheme, sidecar round-trip + validation, and
date labels. Everything camera-shaped is verified on hardware per `docs/05-testing.md` — the
Simulator has no camera, so capture is a physical-device tier; Library and player can be
exercised on the Simulator once a recording file exists.
