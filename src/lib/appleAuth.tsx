/**
 * SDK boundary for expo-apple-authentication, in the house pattern
 * (purchases.ts / deviceClient.ts): the module is require()d inside try/catch
 * so a binary built without the native half degrades to "Apple sign-in
 * unavailable" instead of crashing at import — six TestFlight builds died on
 * static imports before this rule existed.
 *
 * The button lives here too, for the same reason: Apple's branding rules say
 * Sign in with Apple must be offered on Apple's own button, and that button is
 * a native view. Reaching it through the same require() guard keeps a
 * half-built binary rendering nothing instead of red-screening.
 */
import { StyleSheet, useColorScheme, type StyleProp, type ViewStyle } from "react-native";

import { MIN_TOUCH_TARGET, radius } from "@/theme/tokens";

interface AppleAuthModule {
  isAvailableAsync: () => Promise<boolean>;
  signInAsync: (options: { requestedScopes: number[] }) => Promise<{
    identityToken: string | null;
    // Apple sends the name on the FIRST authorization for this Apple ID and
    // never again — not in the identity token, not on any later sign-in.
    fullName?: { givenName?: string | null; familyName?: string | null } | null;
  }>;
  AppleAuthenticationScope: { FULL_NAME: number; EMAIL: number };
  AppleAuthenticationButton?: React.ComponentType<{
    onPress: () => void;
    buttonType: number;
    buttonStyle: number;
    cornerRadius?: number;
    style?: StyleProp<ViewStyle>;
  }>;
  AppleAuthenticationButtonType?: { CONTINUE: number };
  AppleAuthenticationButtonStyle?: { WHITE: number; BLACK: number };
}

let cached: AppleAuthModule | null | undefined;

function loadAppleAuth(): AppleAuthModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("expo-apple-authentication") as unknown;
    const record = module as Record<string, unknown>;
    // Deliberately only the three sign-in members: the button is optional, and
    // an odd build that ships one without the other must still be able to sign
    // in rather than losing Apple entirely.
    if (
      typeof record.isAvailableAsync === "function" &&
      typeof record.signInAsync === "function" &&
      typeof record.AppleAuthenticationScope === "object"
    ) {
      cached = module as unknown as AppleAuthModule;
    } else {
      cached = null;
    }
  } catch {
    cached = null;
  }
  return cached;
}

/** True when the module loaded AND the device offers Sign in with Apple. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  const module = loadAppleAuth();
  if (module === null) return false;
  try {
    return await module.isAvailableAsync();
  } catch {
    return false;
  }
}

export type AppleSignInResult =
  | { status: "ok"; identityToken: string; fullName: string | null }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

/** Run the native Apple sign-in sheet. Never throws. */
export async function nativeAppleSignIn(): Promise<AppleSignInResult> {
  const module = loadAppleAuth();
  if (module === null) return { status: "unavailable" };
  try {
    const credential = await module.signInAsync({
      requestedScopes: [
        module.AppleAuthenticationScope.FULL_NAME,
        module.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (typeof credential.identityToken !== "string" || credential.identityToken.length === 0) {
      return { status: "failed", message: "Apple didn't return an identity token." };
    }
    // Join once, here, so callers never have to know Apple's name shape. Every
    // sign-in after the first sends nulls, which must collapse to null — not
    // to an empty string that would overwrite a good stored name.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .join(" ");
    return {
      status: "ok",
      identityToken: credential.identityToken,
      fullName: name.length > 0 ? name : null,
    };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_REQUEST_CANCELED") return { status: "cancelled" };
    return { status: "failed", message: appleFailureMessage(code, error) };
  }
}

/**
 * Turn Apple's error codes into something a person can act on.
 *
 * ASAuthorizationError.unknown (1000) is the one that matters: it is what the
 * sheet's own "Sign Up Not Completed" alert reports back, and Apple's own text
 * for it — "the authorization attempt failed for an unknown reason" — leaves a
 * tester with nowhere to go. It nearly always means Apple's side is refusing,
 * not the app: a stale authorization from an earlier account, an Apple ID
 * without two-factor, a sandbox tester account, or Apple throttling repeated
 * attempts from one device.
 */
function appleFailureMessage(code: unknown, error: unknown): string {
  if (code === "ERR_REQUEST_UNKNOWN" || code === "ERR_REQUEST_FAILED") {
    return (
      "Apple wouldn't complete the sign-in. If you've used Apple with RacketIQ before, " +
      "open Settings → your name → Sign in with Apple → RacketIQ → Stop Using Apple ID, " +
      "then try again. Otherwise check that this Apple ID has two-factor turned on, or use email."
    );
  }
  if (code === "ERR_REQUEST_NOT_HANDLED" || code === "ERR_INVALID_RESPONSE") {
    return "Apple couldn't handle that request. Try again, or use email.";
  }
  return error instanceof Error ? error.message : "Apple sign-in failed.";
}

/**
 * Apple's own button, or null when this binary can't draw it.
 *
 * Apple's branding rules leave no room for a house button here: the mark, the
 * wording, the corner radius and the two approved colourways are all
 * prescribed, and shipping an accent-green pill labelled "Continue with Apple"
 * is a review rejection. White on our dark canvas, black on the light one —
 * the only two styles allowed on a coloured background.
 */
export function AppleSignInButton({ onPress }: { onPress: () => void }) {
  const scheme = useColorScheme();
  const module = loadAppleAuth();
  const Button = module?.AppleAuthenticationButton;
  const Type = module?.AppleAuthenticationButtonType;
  const Style = module?.AppleAuthenticationButtonStyle;
  if (module === null || Button === undefined || Type === undefined || Style === undefined) {
    return null;
  }
  return (
    <Button
      onPress={onPress}
      buttonType={Type.CONTINUE}
      buttonStyle={scheme === "light" ? Style.BLACK : Style.WHITE}
      cornerRadius={radius.md}
      style={styles.button}
    />
  );
}

const styles = StyleSheet.create({
  // The native view draws nothing without an explicit size, and Apple's
  // minimum is the HIG tap target.
  button: { height: MIN_TOUCH_TARGET + 6, width: "100%" },
});
