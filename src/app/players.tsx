import { PlayersScreen } from "@/features/players/PlayersScreen";

/**
 * Players — the roster of people named in the footage. Thin route; everything
 * lives in features/players. Hidden from the tab bar (`href: null` in
 * _layout) and reached from the Library's Players card.
 */
export default function PlayersRoute() {
  return <PlayersScreen />;
}
