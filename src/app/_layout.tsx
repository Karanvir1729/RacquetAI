import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { ColorValue, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthGateScreen, useAuthGate } from "@/features/account/AuthGate";
import { TutorialScreen } from "@/features/onboarding/TutorialScreen";
import { trackEvent } from "@/lib/appEvents";
import { initAuth, useAuthSession } from "@/lib/auth";
import { installCrashGuard, reportLastFatalError } from "@/lib/crashGuard";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/onboarding";
import {
  configure as configureSubscriptions,
  forgetUser,
  identifyUser,
  refresh as refreshEntitlement,
} from "@/lib/subscription";
import { colors } from "@/theme/tokens";

// As early as possible: capture fatal JS errors that TestFlight logs strip.
installCrashGuard();

type IoniconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IoniconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

/**
 * Root layout: error boundary + providers around the tab shell — Record,
 * Referee, Library and Account. Analysis and the import flow are pushed
 * routes (href: null), not tabs. Theme is module-scope tokens
 * (src/theme/tokens.ts — DynamicColorIOS pairs), so there is no theme
 * provider to mount; the canvas colour on Tabs + StatusBar is all the
 * "theming" the root has to do.
 */
export default function RootLayout() {
  // Read once, synchronously, in the initializer: the flag lives in a local
  // file, and deferring it to an effect would flash the tab bar before the
  // tutorial on every cold start.
  const [tutorialDone, setTutorialDone] = useState(hasSeenTutorial);
  // Login gates the whole app: no session, no tabs. The gate is an overlay
  // for the same reason the tutorial is — the shell must not unmount and
  // remount every time a session appears or goes away.
  const gate = useAuthGate();
  const finishTutorial = useCallback(() => {
    markTutorialSeen();
    setTutorialDone(true);
  }, []);

  // Beta forensics: if the previous run died on a fatal JS error, show the
  // captured message so the tester can screenshot it.
  useEffect(() => {
    const t = setTimeout(reportLastFatalError, 1500);
    return () => clearTimeout(t);
  }, []);

  // RevenueCat, in an effect rather than at module scope: nothing on the first
  // frame depends on it, and both calls are no-ops with no API key or no SDK
  // in the binary — the entitlement simply stays "unknown", which never blocks.
  useEffect(() => {
    if (configureSubscriptions()) void refreshEntitlement();
  }, []);

  // Bind the store to the signed-in account so Pro follows the user, not the
  // device: identify on sign-in, and return to an anonymous app-user only when
  // a real user signs OUT (never on the initial null while the session
  // restores, which would reject logOut on an already-anonymous user). No-op in
  // any build without purchases configured.
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const hadUser = useRef(false);
  useEffect(() => {
    if (userId !== null) {
      hadUser.current = true;
      void identifyUser(userId);
    } else if (hadUser.current) {
      hadUser.current = false;
      void forgetUser();
    }
  }, [userId]);

  // Supabase session restore + the one metrics ping per cold start. Both are
  // fire-and-forget: an unreachable network leaves the app signed out and
  // untracked, never broken.
  useEffect(() => {
    initAuth();
    trackEvent("app_open");
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <Tabs
            screenOptions={{
              headerShown: false,
              // accentText, not accent: Optic is a fill, never ink (tokens.ts).
              // Raw accent measures 2.1:1 on the light canvas — docs/04-branding
              // marks that combination "never", and this is the only affordance
              // showing which tab is current, on every screen.
              tabBarActiveTintColor: colors.accentText,
              tabBarInactiveTintColor: colors.textDim,
              tabBarStyle: {
                backgroundColor: colors.panel,
                borderTopColor: colors.line,
                borderTopWidth: 1,
              },
              tabBarLabelStyle: { fontWeight: "600", fontSize: 11 },
              sceneStyle: { backgroundColor: colors.bg },
              // Android-only (inert on iOS): screens pad themselves by the
              // full keyboard height (useKeyboardInset), measured from the
              // bottom of the SCREEN — so the tab bar has to be out of the way
              // or content floats a tab-bar height too high.
              tabBarHideOnKeyboard: true,
            }}
          >
            <Tabs.Screen
              name="index"
              options={{ title: "Record", tabBarIcon: tabIcon("videocam") }}
            />
            <Tabs.Screen
              name="referee"
              options={{ title: "Referee", tabBarIcon: tabIcon("megaphone") }}
            />
            <Tabs.Screen
              name="library"
              options={{ title: "Library", tabBarIcon: tabIcon("albums") }}
            />
            <Tabs.Screen
              name="account"
              options={{ title: "Account", tabBarIcon: tabIcon("person-circle") }}
            />
            {/* Match analysis — reached from Library cards, never the tab bar
                (href: null hides it there); see features/analysis. */}
            <Tabs.Screen name="analysis" options={{ href: null }} />
            {/* Import & analyze flow — reached from the Library's import card. */}
            <Tabs.Screen name="import-analysis" options={{ href: null }} />
            {/* Player profiles — the roster and one player's page, reached from
                the Library's Players card and from a named side on a read-out;
                never tabs (href: null keeps the bar unchanged). */}
            <Tabs.Screen name="players" options={{ href: null }} />
            <Tabs.Screen name="player/[id]" options={{ href: null }} />
            {/* One recording's stored read-out, opened from a profile's feed;
                the same rule — a pushed route, never a tab. */}
            <Tabs.Screen name="clip/[id]" options={{ href: null }} />
            {/* RacketIQ Pro — pushed from the import card once the free
                analyses are spent; never a tab of its own. */}
            <Tabs.Screen name="paywall" options={{ href: null }} />
          </Tabs>
          {/* iOS: "auto" = light icons on the dark theme, dark icons on the
              light one. Android pins the dark palette (tokens.ts dyn()), so
              "auto" on a light-mode device would draw dark icons over the dark
              canvas — force light icons there (app.json android.userInterfaceStyle
              matches). */}
          <StatusBar style={Platform.OS === "ios" ? "auto" : "light"} />
          {/* Overlay layers, absolutely filled, covering the shell instead of
              replacing it so expo-router's Tabs never unmount underneath.
              Order matters: the login gate sits above the tabs, and the
              tutorial above the gate — a brand-new user meets the tutorial
              first, then signs in, then lands in the app. */}
          {gate.covered ? (
            <View style={styles.overlayLayer}>
              <AuthGateScreen />
            </View>
          ) : null}
          {tutorialDone ? null : (
            <View style={styles.overlayLayer}>
              <TutorialScreen onDone={finishTutorial} />
            </View>
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlayLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
});
