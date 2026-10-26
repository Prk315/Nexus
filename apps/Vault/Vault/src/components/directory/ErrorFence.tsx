import React from "react";

// A boundary that keeps one failure inside one pane.
//
// ⚠️ Without this, a throw anywhere under the graph cell blanks the WHOLE app.
// React unmounts the entire tree at an uncaught error, and there was no
// boundary between `ForceGraphView` and the root — so a WebGL context that
// cannot be created, a kapsule that ticks before its layout exists, or a lazy
// chunk whose import rejects (see `lazyWithReload`, which rethrows after its
// one reload) all end as a white page with nothing in the console to say which
// pane was at fault.
//
// `ForceGraphView` has its own boundary, but it is not a substitute: its
// fallback is the 2D graph, so an error that is NOT about WebGL — a bad prop, a
// missing chunk — throws again from inside the fallback, and a boundary that
// throws while rendering its own fallback takes the tree down exactly as if it
// were not there.

interface Props {
  /** Shown instead of the children. Keep it short; it renders inside a pane. */
  label: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorFence extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    // The pane says something; the console says what.
    console.error("[Vault] pane failed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pane-error" role="alert">
        <div className="pane-error-title">{this.props.label}</div>
        <div className="pane-error-detail">{this.state.error.message || String(this.state.error)}</div>
        <button className="pane-error-retry" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
