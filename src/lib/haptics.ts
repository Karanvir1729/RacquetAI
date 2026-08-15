/**
 * Thin wrapper over expo-haptics. Every call is fire-and-forget and swallows
 * errors: haptics are a no-op on unsupported platforms/devices (web, Low Power
 * Mode, simulators), and a failed buzz must never surface to the user or reject
 * a promise a caller forgot to await.
 */
import * as Haptics from "expo-haptics";

/** Medium tap — default for primary button presses (start/stop recording). */
export function tapMedium(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Success chime — recording saved, export finished. */
export function notifySuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Warning buzz — destructive confirmations (delete recording). */
export function notifyWarning(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Light selection tick — toggles and segment changes. */
export function selection(): void {
  void Haptics.selectionAsync().catch(() => {});
}
