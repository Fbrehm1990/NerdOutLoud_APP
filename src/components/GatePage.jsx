import React from "react";
import { C } from "../lib/constants.js";
import { SectionHead } from "./Shared.jsx";

export function GatePage({ what, onSignup, onSignin }) {
  return (
    <div className="nol-fade" style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Members only" title="Create your free account"
        sub={`The movie picker is free for everyone — ${what} unlock with an account.`} />
      <div style={{
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 22,
        textAlign: "center", boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
      }}>
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.65, margin: "0 0 18px" }}>
          A free account keeps your Rating List, ratings, and calibration score synced across
          every device — and unlocks The Lobby, where you can post your takes for other patrons to see.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="nol-btn big" onClick={onSignup}>Create an account</button>
          <button className="nol-ghost" onClick={onSignin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}
