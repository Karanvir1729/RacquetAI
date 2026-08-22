import { useLocalSearchParams } from "expo-router";

import { PlayerProfileScreen } from "@/features/players/PlayerProfileScreen";

/**
 * One player's profile — thin route; everything lives in features/players.
 * Hidden from the tab bar (`href: null` in _layout) and reached from the
 * roster or from a named side on a read-out: `/player/<player id>`. Params
 * are boundary input, so they are narrowed here rather than trusted.
 */
export default function PlayerRoute() {
  const params = useLocalSearchParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <PlayerProfileScreen id={id} />;
}
