/**
 * SDK boundary for expo-apple-authentication, in the house pattern
 * (purchases.ts / deviceClient.ts): the module is require()d inside try/catch
 * so a binary built without the native half degrades to "Apple sign-in
 * unavailable" instead of crashing at import — six TestFlight builds died on
 * static imports before this rule existed.
 */

interface AppleAuthModule {
  isAvailableAsync: () => Promise<boolean>;
  signInAsync: (options: {
    requestedScopes: number[];
  }) => Promise<{ identityToken: string | null; fullName?: { givenName?: string | null } | null }>;
  AppleAuthenticationScope: { FULL_NAME: number; EMAIL: number };
}

let cached: AppleAuthModule | null | undefined;

function loadAppleAuth(): AppleAuthModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("expo-apple-authentication") as unknown;
    const record = module as Record<string, unknown>;
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
  | { status: "ok"; identityToken: string; givenName: string | null }
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
    return {
      status: "ok",
      identityToken: credential.identityToken,
      givenName: credential.fullName?.givenName ?? null,
    };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_REQUEST_CANCELED") return { status: "cancelled" };
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Apple sign-in failed.",
    };
  }
}
