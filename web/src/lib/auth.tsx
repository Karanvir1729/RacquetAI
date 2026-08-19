import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { trackEvent } from "@/lib/events";
import { supabase } from "@/lib/supabase";

/**
 * Session state for the whole site. One subscription to Supabase auth, exposed
 * through context; `loading` covers the initial session restore so guarded
 * pages can wait instead of bouncing a signed-in visitor to /login.
 */

interface AuthState {
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
    });
    // SIGNED_IN also fires on tab refocus and token refresh; only a
    // signed-out -> signed-in transition is a login worth counting.
    let lastUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false });
      const userId = session?.user.id ?? null;
      if (event === "SIGNED_IN" && userId !== null && userId !== lastUserId) {
        trackEvent("login");
      }
      lastUserId = userId;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Message fit to put in front of a person, from whatever Supabase threw. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/already registered/i.test(message)) return "That email already has an account — sign in instead.";
  return message;
}

export async function signInWithApple(next = "/account"): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: `${window.location.origin}${next}` },
  });
  return error ? friendly(error.message) : null;
}

export async function signInWithEmail(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? friendly(error.message) : null;
}

/** null = signed in; "confirm" = account made but email confirmation pending. */
export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<string | "confirm" | null> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return friendly(error.message);
  trackEvent("signup", { method: "email" });
  // With "Confirm email" enabled Supabase returns a user but no session —
  // navigating on as if signed in would dead-end on the login guard.
  return data.session === null ? "confirm" : null;
}

export async function signOut(): Promise<void> {
  trackEvent("logout");
  await supabase.auth.signOut();
}
