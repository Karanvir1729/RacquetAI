import { Ionicons } from "@expo/vector-icons";
import { Tabs, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComponentProps, useEffect } from "react";
import { ColorValue, Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { colors } from "@/theme/tokens";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IoniconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

/**
 * Root layout: error boundary + providers around the 4-tab shell. Theme is
 * module-scope tokens (src/theme/tokens.ts — DynamicColorIOS pairs), so there
 * is no theme provider to mount; the canvas colour on Tabs + StatusBar is all
 * the "theming" the root has to do.
 */
export default function RootLayout() {
  // DEV autorun (simulator): jump straight into the on-device import flow so
  // the native pipeline can be exercised hands-free. Env-gated; no-op in
  // production bundles.
  useEffect(() => {
    if (__DEV__ && process.env.EXPO_PUBLIC_AUTORUN_OPEN) {
      const id = process.env.EXPO_PUBLIC_AUTORUN_OPEN;
      const t = setTimeout(() => {
        router.push({ pathname: "/analysis", params: { id } });
      }, 1200);
      return () => clearTimeout(t);
    }
    if (__DEV__ && process.env.EXPO_PUBLIC_AUTORUN_SAMPLE === "1") {
      const t = setTimeout(() => {
        router.push({
          pathname: "/import-analysis",
          params: {
            videoUri:
              "file:///Users/karanvirkhanna/RacquetAI/analysis/samples/pexels_squash.mp4",
          },
        });
      }, 1200);
      return () => clearTimeout(t);
    }
    return undefined;
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
            <Tabs.Screen name="score" options={{ title: "Score AI", tabBarIcon: tabIcon("tennisball") }} />
            <Tabs.Screen
              name="settings"
              options={{ title: "Settings", tabBarIcon: tabIcon("settings") }}
            />
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
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
