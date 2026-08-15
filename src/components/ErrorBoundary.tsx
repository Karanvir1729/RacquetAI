/**
 * Root error boundary. Without one, a single render throw unmounts the entire
 * tree and drops the player back to the launcher with no explanation — and
 * with no crash reporting in the app, silently. This keeps the failure
 * on-brand and recoverable: the state that threw is usually transient (a bad
 * cache entry, a malformed asset), so remounting the tree is a genuine fix
 * most of the time.
 */
import { Component, type PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme/tokens";

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // The only signal there is until crash reporting exists.
    console.error("Root error boundary caught", error);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something broke</Text>
        <Text style={styles.body}>
          RacquetAI hit an unexpected error. Recordings already saved on this device are safe —
          this is only a display problem.
        </Text>
        <Button label="Try again" onPress={this.handleRetry} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "stretch",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...type.title, color: colors.text, textAlign: "center" },
  body: { ...type.body, color: colors.textDim, textAlign: "center", lineHeight: 22 },
});
