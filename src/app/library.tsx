import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";

/**
 * Library tab — placeholder. The recordings list (thumbnails, durations via
 * src/lib/format.ts, playback with expo-video) is owned by
 * src/features/recording/ and lands from the feat/video-recording worktree.
 */
export default function LibraryScreen() {
  return (
    <Screen>
      <ScreenHeader title="Library" subtitle="Your recorded matches" />
      <EmptyState
        title="No matches yet"
        caption="Recordings you capture on the Record tab will appear here for playback and scoring."
        icon="film-outline"
      />
    </Screen>
  );
}
