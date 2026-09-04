/**
 * Root error boundary. Without one, a single render throw unmounts the entire
 * tree and leaves the visitor on a blank white page with no explanation — and
 * with no crash reporting on the site, silently. This keeps the failure
 * on-brand and recoverable: the state that threw is usually transient (a bad
 * analysis payload, a malformed asset), so remounting the tree is a genuine fix
 * most of the time.
 */
import { Component, type PropsWithChildren } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";

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
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-4 px-5 py-16 text-center sm:px-6">
        <h1 className="rq-h3">Something broke</h1>
        <p className="rq-body" style={{ color: "var(--rq-text-dim)" }}>
          RacketIQ hit an unexpected error. Nothing you uploaded has gone anywhere — this is only
          a display problem.
        </p>
        <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button size="md" onClick={this.handleRetry}>
            Try again
          </Button>
          {/* Same reset, but lands somewhere known-good — a route that throws on
              every render would otherwise re-break the moment it remounts. */}
          <ButtonLink to="/" size="md" variant="outline" onClick={this.handleRetry}>
            Back to the start
          </ButtonLink>
        </div>
      </div>
    );
  }
}
