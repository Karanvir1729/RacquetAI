import { useLocalSearchParams } from "expo-router";

import { RefereeScreen } from "@/features/scoring/RefereeScreen";

/**
 * Referee — thin route; everything lives in features/scoring. It is the
 * "Referee" tab in _layout AND a push from the Library's Score keeper card,
 * which passes `?from=library`.
 *
 * That param is the ONLY way the screen can tell the two apart. `canGoBack()`
 * is true either way inside a tab navigator — switching tabs is history — so
 * relying on it would draw a "‹ Library" chevron on a tab nobody reached from
 * the Library. Params are boundary input, so it is narrowed here.
 */
export default function RefereeRoute() {
  const params = useLocalSearchParams();
  return <RefereeScreen fromLibrary={params.from === "library"} />;
}
