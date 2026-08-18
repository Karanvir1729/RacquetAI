import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComponentProps, useCallback, useEffect, useState } from "react";
import { ColorValue, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TutorialScreen } from "@/features/onboarding/TutorialScreen";
import { installCrashGuard, reportLastFatalError } from "@/lib/crashGuard";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/onboarding";
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
 * Root layout: error boundary + providers around the two-tab shell — Record
 * and Library, the only two things the app does. Analysis and the import flow
 * are pushed routes (href: null), not tabs. Theme is module-scope tokens
 * (src/theme/tokens.ts — DynamicColorIOS pairs), so there is no theme
 * provider to mount; the canvas colour on Tabs + StatusBar is all the
 * "theming" the root has to do.
 */
export default function RootLayout() {
  // Read once, synchronously, in the initializer: the flag lives in a local
  // file, and deferring it to an effect would flash the tab bar before the
  // tutorial on every cold start.
  const [tutorialDone, setTutorialDone] = useState(hasSeenTutorial);
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

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.accent,
              tabBarInactiveTintColor: colors.textFaint,
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
            <Tabs.Screen name="index" options={{ title: "Record", tabBarIcon: tabIcon("videocam") }} />
            <Tabs.Screen name="library" options={{ title: "Library", tabBarIcon: tabIcon("albums") }} />
            {/* Match analysis — reached from Library cards, never the tab bar
                (href: null hides it there); see features/analysis. */}
            <Tabs.Screen name="analysis" options={{ href: null }} />
            {/* Import & analyze flow — reached from the Library's import card. */}
            <Tabs.Screen name="import-analysis" options={{ href: null }} />
          </Tabs>
          {/* iOS: "auto" = light icons on the dark theme, dark icons on the
              light one. Android pins the dark palette (tokens.ts dyn()), so
              "auto" on a light-mode device would draw dark icons over the dark
              canvas — force light icons there (app.json android.userInterfaceStyle
              matches). */}
          <StatusBar style={Platform.OS === "ios" ? "auto" : "light"} />
          {/* Last sibling, absolutely filled: the tutorial covers the shell
              instead of replacing it, so expo-router's Tabs never unmount and
              remount underneath it. */}
          {tutorialDone ? null : (
            <View style={styles.tutorialLayer}>
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
  tutorialLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
});
