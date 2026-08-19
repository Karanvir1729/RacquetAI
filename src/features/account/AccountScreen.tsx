/**
 * Account tab: sign in (Apple native or email), the subscription card, and
 * the analysis-engine settings. In-app purchases go through the App Store
 * (the /paywall route, RevenueCat) — Apple's rules for digital goods; the
 * web app is where Stripe lives. A subscription bought on the web still
 * shows here via /billing/status, re-read on focus and on foregrounding.
 */
import { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, TextInput, View, type AppStateStatus } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EngineSettingsCard } from "@/features/analysis/EngineSettingsCard";
import {
  isAppleSignInAvailable,
  signInWithApple,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  useAuthSession,
} from "@/lib/auth";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { fetchBillingStatus, type BillingStatus, type Plan } from "./billingClient";

const PLAN_LABEL: Record<Plan, string> = {
  monthly: "RacquetIQ Pro — $9.99 / month",
  yearly: "RacquetIQ Pro — $79.99 / year",
};

export function AccountScreen() {
  const session = useAuthSession();
  return (
    <Screen scroll>
      <ScreenHeader title="Account" subtitle={session ? "Signed in" : "Sign in to RacquetIQ"} />
      {session ? <SignedInCard email={session.user.email ?? "Signed in"} /> : <SignInCard />}
      {/* Engine choice is device-level, not account-level — always shown.
          Cross-feature import documented in EngineSettingsCard's header. */}
      <EngineSettingsCard />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Signed out
// ---------------------------------------------------------------------------

function SignInCard() {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void isAppleSignInAvailable().then((available) => {
      if (active) setAppleAvailable(available);
    });
    return () => {
      active = false;
    };
  }, []);

  const runApple = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await signInWithApple();
    setBusy(false);
    if (result.status === "failed") setError(result.message);
  }, []);

  const runEmail = useCallback(async () => {
    if (email.trim().length === 0 || password.length === 0) {
      setError("Email and password, both.");
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      mode === "signin"
        ? await signInWithEmail(email.trim(), password)
        : await signUpWithEmail(email.trim(), password);
    setBusy(false);
    if (result.status === "failed") setError(result.message);
  }, [email, password, mode]);

  return (
    <View style={styles.card}>
      {appleAvailable ? (
        <Button
          label=" Continue with Apple"
          onPress={() => void runApple()}
          loading={busy}
        />
      ) : null}

      <Text style={styles.divider}>{appleAvailable ? "or with email" : "Sign in with email"}</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        value={password}
        onChangeText={setPassword}
      />

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={mode === "signin" ? "Sign in" : "Create account"}
        variant="secondary"
        onPress={() => void runEmail()}
        loading={busy}
      />
      <Text
        style={styles.switchMode}
        onPress={() => {
          setMode((value) => (value === "signin" ? "signup" : "signin"));
          setError(null);
        }}
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

function SignedInCard({ email }: { email: string }) {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [checked, setChecked] = useState(false);

  const reload = useCallback(() => {
    void fetchBillingStatus().then((status) => {
      setBilling(status);
      setChecked(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Focus does NOT fire on background→foreground, and coming back from the
  // Safari checkout is exactly that trip — the same lesson as
  // useForegroundEntitlementRefresh in lib/subscription.ts.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") reload();
    };
    try {
      const subscription = AppState.addEventListener("change", onChange);
      return () => {
        try {
          subscription.remove();
        } catch {
          // Hosts without a real AppState (tests): nothing to detach.
        }
      };
    } catch {
      return undefined;
    }
  }, [reload]);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.email}>{email}</Text>
        <Text style={styles.dim}>
          {billing?.active
            ? billing.plan !== null
              ? PLAN_LABEL[billing.plan]
              : "RacquetIQ Pro — active"
            : checked
              ? "Free — 3 analyses of your own videos included."
              : "Checking your plan…"}
        </Text>
        {billing === null && checked ? (
          <Text style={styles.dim}>
            Billing server unreachable — plan status may be stale. It lives on the analysis
            server (see Analysis engine below).
          </Text>
        ) : null}
      </View>

      {billing !== null && !billing.active ? (
        <View style={styles.card}>
          <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
          <Text style={styles.dim}>
            Unlimited analyses, $9.99 a month or $79.99 a year. In the app, subscriptions go
            through the App Store; on racquetiq.app they go through Stripe — either one shows
            up here.
          </Text>
          <Button label="See Pro plans" onPress={() => router.push("/paywall")} />
        </View>
      ) : null}

      <Button label="Sign out" variant="danger" onPress={() => void signOutUser()} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  divider: {
    ...type.caption,
    color: colors.textFaint,
    textAlign: "center",
    marginVertical: spacing.xs,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.cardRaised,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...type.body,
  },
  error: { ...type.caption, color: colors.danger },
  switchMode: {
    ...type.label,
    color: colors.textDim,
    textAlign: "center",
    paddingVertical: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  email: { ...type.bodyStrong, color: colors.text },
  dim: { ...type.caption, color: colors.textDim },
  upgradeTitle: { ...type.heading, color: colors.text },
});
