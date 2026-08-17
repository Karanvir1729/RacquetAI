/**
 * Beta crash forensics. TestFlight crash logs strip the JavaScript error
 * message, which made the import-crash hunt blind — so in release builds we
 * hook the global error handler, persist every fatal JS error to
 * `<documents>/last-fatal-error.json` BEFORE React Native aborts the process,
 * and on the next launch surface it in an alert the tester can screenshot.
 * The previous handler still runs (the crash still crashes) — this only
 * captures the message the .ips files lose. Dev builds keep the red screen.
 */
import { File, Paths } from "expo-file-system";
import { Alert } from "react-native";

const FILE_NAME = "last-fatal-error.json";

interface RNErrorUtils {
  getGlobalHandler(): ((error: unknown, isFatal?: boolean) => void) | null;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

function errorFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** Install the capture hook. Call once, as early as possible. No-op in dev. */
export function installCrashGuard(): void {
  if (__DEV__) return;
  const utils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (!utils || typeof utils.setGlobalHandler !== "function") return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    try {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error && error.stack ? error.stack.slice(0, 4000) : null;
      const file = errorFile();
      if (!file.exists) file.create();
      file.write(
        JSON.stringify({ v: 1, at: new Date().toISOString(), fatal: isFatal === true, message, stack }),
      );
    } catch {
      // Never let forensics mask the original error.
    }
    previous?.(error, isFatal);
  });
}

/**
 * If the previous run died on a fatal JS error, show it (screenshot-able by
 * the tester) and clear the file. Call once after the first screen mounts.
 */
export function reportLastFatalError(): void {
  try {
    const file = errorFile();
    if (!file.exists) return;
    // Read then DELETE before parsing: a truncated/empty file from a dying
    // process must not survive to silently re-fail on every future launch.
    const raw = file.textSync();
    file.delete();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    const record = parsed as { at?: unknown; message?: unknown; stack?: unknown };
    const message = typeof record.message === "string" ? record.message : "(no message)";
    const stack = typeof record.stack === "string" ? `\n\n${record.stack.slice(0, 600)}` : "";
    const at = typeof record.at === "string" ? record.at : "";
    Alert.alert(
      "Last run crashed",
      `${at}\n${message}${stack}\n\nPlease screenshot this and send it to the developer.`,
    );
  } catch {
    // Forensics must never break a healthy launch.
  }
}
