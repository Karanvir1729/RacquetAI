import { useLocalSearchParams } from "expo-router";

import { ImportAnalysisScreen } from "@/features/analysis/ImportAnalysisScreen";

/**
 * Import & analyze — thin route; everything lives in features/analysis.
 * Hidden from the tab bar (`href: null` in _layout) and reached from the
 * Library's "Import & analyze" card with `?videoUri=<file://…>`. Params are
 * boundary input, so they are narrowed here rather than trusted.
 */
export default function ImportAnalysisRoute() {
  const params = useLocalSearchParams();
  const videoUri =
    typeof params.videoUri === "string" && params.videoUri.length > 0 ? params.videoUri : null;
  return <ImportAnalysisScreen videoUri={videoUri} />;
}
