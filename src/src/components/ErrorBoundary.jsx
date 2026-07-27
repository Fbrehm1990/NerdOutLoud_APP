import React from "react";
import { C } from "../lib/constants.js";
import { reportError } from "../lib/errorMonitoring.js";

// React Error Boundaries must be class components — there is no hook
// equivalent for componentDidCatch/getDerivedStateFromError as of React 18.
// Catches render-time errors anywhere below it in the tree and shows a
// branded fallback instead of a blank white screen. Does NOT catch errors
// in event handlers, async code, or effects — those are handled with their
// own try/catch throughout the app already (the pattern used everywhere
// else in this codebase: quiet failure, never a crash).
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    reportError(error, { componentStack: info.componentStack });
  }

  handleReload = () => {
    // A hard reload rather than just resetting local state — the error may
    // have come from corrupted state that a soft reset wouldn't clear.
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "40px 20px", textAlign: "center", background: C.bg,
      }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, letterSpacing: "0.06em", color: C.text, marginBottom: 12 }}>
          Something went <span style={{ color: C.amber }}>sideways</span>
        </div>
        <p style={{ color: C.muted, fontSize: 15, maxWidth: 420, lineHeight: 1.6, marginBottom: 26 }}>
          The picker hit a snag. Your watchlist and ratings are safe — they're saved
          separately from whatever just broke. A reload usually fixes this.
        </p>
        <button onClick={this.handleReload} style={{
          background: C.amber, color: "#14120A", border: "none", borderRadius: 10,
          padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer",
          fontFamily: "inherit",
        }}>
          Reload REELmunity
        </button>
      </div>
    );
  }
}
