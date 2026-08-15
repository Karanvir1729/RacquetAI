/**
 * Library list state: reads the store on every tab focus, so a take saved on
 * the Record tab appears the moment the user switches over — no cross-tab
 * event plumbing, the filesystem is the single source of truth.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { listRecordings } from "./storage";
import type { RecordingEntry } from "./types";

interface RecordingsState {
  status: "loading" | "ready" | "error";
  recordings: RecordingEntry[];
}

export function useRecordings(): RecordingsState & { reload: () => void } {
  const [state, setState] = useState<RecordingsState>({ status: "loading", recordings: [] });

  const reload = useCallback(() => {
    try {
      setState({ status: "ready", recordings: listRecordings() });
    } catch {
      setState({ status: "error", recordings: [] });
    }
  }, []);

  useFocusEffect(reload);

  return { ...state, reload };
}
