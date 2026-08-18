import { RefereeScreen } from "@/features/scoring/RefereeScreen";

/**
 * Score keeper — thin route; everything lives in features/scoring. Hidden from
 * the tab bar (`href: null` in _layout, like /analysis) and reached from the
 * Library card: the app is deliberately two tabs.
 */
export default function RefereeRoute() {
  return <RefereeScreen />;
}
