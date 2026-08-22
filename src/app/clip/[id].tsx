import { useLocalSearchParams } from "expo-router";

import { ClipDetailScreen } from "@/features/players/ClipDetailScreen";

/**
 * One recording's stored read-out — thin route; everything lives in
 * features/players. Hidden from the tab bar (`href: null` in _layout) and
 * reached from a profile's recordings feed: `/clip/<clip id>?player=<player
 * id>`. Params are boundary input, so they are narrowed here rather than
 * trusted.
 */
export default function ClipRoute() {
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";
  const playerId = typeof params.player === "string" ? params.player : "";
  return <ClipDetailScreen id={id} playerId={playerId} />;
}
