import { useLocalSearchParams } from "expo-router";

import { AnalysisScreen } from "@/features/analysis/AnalysisScreen";

/**
 * Match Analysis — thin route; everything lives in features/analysis. Hidden
 * from the tab bar (`href: null` in _layout) and reached from the Library:
 * `/analysis?source=demo` or `/analysis?id=<recording id>`. Params are
 * boundary input, so they are narrowed here rather than trusted.
 */
export default function AnalysisRoute() {
  const params = useLocalSearchParams();
  const source = typeof params.source === "string" ? params.source : undefined;
  const id = typeof params.id === "string" ? params.id : undefined;
  return <AnalysisScreen source={source} recordingId={id} />;
}
