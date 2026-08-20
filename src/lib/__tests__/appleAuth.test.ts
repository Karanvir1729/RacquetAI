/**
 * The Apple SDK boundary. Two things here are easy to get wrong and expensive
 * to get wrong:
 *
 * - Apple sends the user's name on the FIRST authorization for an Apple ID and
 *   never again. Dropping it, or writing an empty string over a good one, is
 *   permanent — there is no second chance to ask.
 * - ASAuthorizationError.unknown is what the sheet's own "Sign Up Not
 *   Completed" alert reports back. Apple's wording for it explains nothing, so
 *   the boundary has to hand the user somewhere to go.
 *
 * The module require()s expo-apple-authentication once and caches it, so every
 * case resets the module registry before re-requiring.
 */

interface Credential {
  identityToken: string | null;
  fullName?: { givenName?: string | null; familyName?: string | null } | null;
}

function mockApple(signIn: () => Promise<Credential>): void {
  jest.doMock("expo-apple-authentication", () => ({
    isAvailableAsync: async () => true,
    signInAsync: signIn,
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  }));
}

async function signIn(credential: Credential) {
  mockApple(async () => credential);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nativeAppleSignIn } = require("../appleAuth") as typeof import("../appleAuth");
  return nativeAppleSignIn();
}

async function signInThrowing(error: unknown) {
  mockApple(async () => {
    throw error;
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nativeAppleSignIn } = require("../appleAuth") as typeof import("../appleAuth");
  return nativeAppleSignIn();
}

beforeEach(() => {
  jest.resetModules();
});

describe("the name Apple only ever sends once", () => {
  it("joins the given and family name on the first authorization", async () => {
    const result = await signIn({
      identityToken: "token",
      fullName: { givenName: "Ada", familyName: "Lovelace" },
    });
    expect(result).toEqual({ status: "ok", identityToken: "token", fullName: "Ada Lovelace" });
  });

  it("keeps a half name rather than nothing", async () => {
    const result = await signIn({ identityToken: "token", fullName: { givenName: "Ada" } });
    expect(result).toMatchObject({ status: "ok", fullName: "Ada" });
  });

  it("reports null — not an empty string — on every sign-in after the first", async () => {
    const result = await signIn({ identityToken: "token", fullName: null });
    // An empty string here would overwrite the name captured at signup.
    expect(result).toMatchObject({ status: "ok", fullName: null });
  });

  it("treats blank name parts as no name at all", async () => {
    const result = await signIn({
      identityToken: "token",
      fullName: { givenName: "  ", familyName: null },
    });
    expect(result).toMatchObject({ status: "ok", fullName: null });
  });
});

describe("failures", () => {
  it("reads a token-less credential as a failure, not a session", async () => {
    const result = await signIn({ identityToken: null });
    expect(result.status).toBe("failed");
  });

  it("separates a cancel from a failure", async () => {
    const result = await signInThrowing({ code: "ERR_REQUEST_CANCELED" });
    expect(result).toEqual({ status: "cancelled" });
  });

  it("tells the user where to go when Apple refuses the authorization", async () => {
    // This is the "Sign Up Not Completed" path: Apple's own message for it is
    // "the authorization attempt failed for an unknown reason", which is a
    // dead end. The stale-authorization escape hatch has to be named.
    const result = await signInThrowing({
      code: "ERR_REQUEST_UNKNOWN",
      message: "The authorization attempt failed for an unknown reason",
    });
    expect(result.status).toBe("failed");
    const message = result.status === "failed" ? result.message : "";
    expect(message).toContain("Stop Using Apple ID");
    expect(message).not.toContain("unknown reason");
  });

  it("falls back to the SDK's own message for codes it has no advice for", async () => {
    const result = await signInThrowing(Object.assign(new Error("boom"), { code: "ERR_OTHER" }));
    expect(result).toEqual({ status: "failed", message: "boom" });
  });

  it("reports unavailable when the binary has no native half", async () => {
    jest.doMock("expo-apple-authentication", () => ({}));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nativeAppleSignIn } = require("../appleAuth") as typeof import("../appleAuth");
    expect(await nativeAppleSignIn()).toEqual({ status: "unavailable" });
  });
});
