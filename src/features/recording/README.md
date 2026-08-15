# features/recording

Owned by the **feat/video-recording** worktree (`.worktrees/video`). Everything about capturing
and storing match footage lives here: the expo-camera capture screen (preview, record/stop,
keep-awake, portrait lock), writing finished takes with expo-file-system, the expo-media-library
save path, and the Library list + expo-video playback. It also owns the route bodies of
`src/app/index.tsx` (Record) and `src/app/library.tsx`. Other branches must not edit files in
this folder or those two routes — shared primitives graduate to `src/components/` via main.
