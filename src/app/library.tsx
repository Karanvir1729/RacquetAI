import { StyleSheet, View } from "react-native";

import { PlayersEntryCard } from "@/features/players/PlayersEntryCard";
import { LibraryScreen } from "@/features/recording/LibraryScreen";

/**
 * Library tab — thin route. The Library itself lives in features/recording;
 * the Players card is the player feature's door, docked under the list so it
 * is reachable whatever the list holds. Composed here rather than inside the
 * Library screen because routes are where features meet (docs/01 rule 1).
 */
export default function LibraryRoute() {
  return (
    <View style={styles.root}>
      <LibraryScreen />
      <PlayersEntryCard />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
