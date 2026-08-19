/**
 * The app's auth API — the only module screens import for accounts. Session
 * state lives in a module-scope store read through useSyncExternalStore (the
 * subscription.ts pattern): it is one object, it changes a handful of times
 * per install, and no provider needs to mount for it.
 *
 * Every operation returns a result value and never throws; "signed out"
 * because a call failed must degrade to the signed-out UI, not a crash.
 */
import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";

import { trackEvent } from "./appEvents";
import { isAppleSignInAvailable, nativeAppleSignIn } from "./appleAuth";
import { supabase } from "./supabaseClient";

let session: Session | null = null;
let initialized = false;
/**
 * False until the persisted session has been read once. The gate holds a
 * blank frame rather than the sign-in form until this flips — flashing the
 * login at every signed-in cold start would read as being logged out.
 */
let ready = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One bad listener must not stop the others.
    }
  }
}

function setSession(next: Session | null): void {
  session = next;
  notify();
}

export function getSession(): Session | null {
  return session;
}

function getReady(): boolean {
  return ready;
}

function markReady(): void {
  if (ready) return;
  ready = true;
  notify();
}

/** Has the persisted session been restored yet? */
export function useAuthReady(): boolean {
  return useSyncExternalStore(subscribe, getReady, getReady);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live session. Re-renders on sign-in/out and token refresh. */
export function useAuthSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

/**
 * Restore the persisted session and start listening. Called once from the
 * root layout's effect; safe to call again (no-op).
 */
export function initAuth(): void {
  if (initialized) return;
  initialized = true;
  void supabase.auth
    .getSession()
    .then(({ data }) => setSession(data.session))
    .catch(() => setSession(null))
    .finally(markReady);
  supabase.auth.onAuthStateChange((event, next) => {
    setSession(next);
    if (event === "SIGNED_IN") trackEvent("login");
  });
}

export type AuthResult = { status: "ok" } | { status: "cancelled" } | { status: "failed"; message: string };

/**
 * Native Sign in with Apple → Supabase. Needs the Apple provider enabled in
 * Supabase with this app's bundle id in its client ids (done), and a build
 * whose binary carries the expo-apple-authentication pod + entitlement.
 */
export async function signInWithApple(): Promise<AuthResult> {
  const native = await nativeAppleSignIn();
  if (native.status === "cancelled") return { status: "cancelled" };
  if (native.status === "unavailable") {
    return {
      status: "failed",
      message: "Sign in with Apple isn't available in this build — use email instead.",
    };
  }
  if (native.status === "failed") return { status: "failed", message: native.message };
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: native.identityToken,
  });
  if (error) return { status: "failed", message: error.message };
  // No event here — the onAuthStateChange listener already logs the login.
  return { status: "ok" };
}

export { isAppleSignInAvailable };

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const message = /invalid login credentials/i.test(error.message)
      ? "Wrong email or password."
      : error.message;
    return { status: "failed", message };
  }
  return { status: "ok" };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    const message = /already registered/i.test(error.message)
      ? "That email already has an account — sign in instead."
      : error.message;
    return { status: "failed", message };
  }
  trackEvent("signup", { method: "email" });
  // A user without a session means Supabase is holding the account for email
  // confirmation (off today, but a dashboard toggle away) — say so instead of
  // leaving the form sitting there signed out with no explanation.
  if (data.session === null) {
    return {
      status: "failed",
      message: "Account created — confirm it from the email we sent, then sign in.",
    };
  }
  return { status: "ok" };
}

export async function signOutUser(): Promise<void> {
  trackEvent("logout");
  try {
    await supabase.auth.signOut();
  } catch {
    // The listener already cleared local state on the attempt; worst case the
    // server-side session ages out.
  }
}
