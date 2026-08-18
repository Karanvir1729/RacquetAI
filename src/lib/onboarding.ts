/**
 * "Has the tutorial been seen" flag — a tiny JSON file in the documents
 * sandbox, the same sync sidecar pattern as the rest of the app's config.
 * Read once at launch, so it has to be cheap and it has to be total: an
 * unreadable flag means "show the tutorial", never a crash on a cold start.
 */
import { File, Paths } from "expo-file-system";

const FILE_NAME = "onboarding.json";

function flagFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** True only when a completed run was recorded. Never throws. */
export function hasSeenTutorial(): boolean {
  try {
    const file = flagFile();
    if (!file.exists) return false;
    const parsed: unknown = JSON.parse(file.textSync());
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { seen?: unknown }).seen === true
    );
  } catch {
    return false;
  }
}

/** Record that the tutorial finished. Silent on disk error — worst case it shows again. */
export function markTutorialSeen(): void {
  try {
    const file = flagFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify({ v: 1, seen: true }));
  } catch {
    // A tutorial shown twice is a far smaller problem than a crash here.
  }
}
