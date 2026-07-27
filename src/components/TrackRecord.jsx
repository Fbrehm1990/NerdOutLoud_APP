import React, { useState } from "react";
import { C } from "../lib/constants.js";
import { calStats, postToLobby } from "../lib/utils.js";
import { Panel } from "./Shared.jsx";

export function TrackRecord({ state, setState, user }) {
  const { done, avgGap } = calStats(state);
  const nightFilmId = state.night ? state.night.filmId : null;
  const open = state.predictions.filter(p => p.actual == null && p.filmId !== nightFilmId);
  const [rateVal, setRateVal] = useState({});

  const rate = (p) => {
    const val = rateVal[p.filmId] != null ? rateVal[p.filmId] : 7.5;
    const f = state.films.find(x => x.id === p.filmId);
    if (f) {
      postToLobby(f, {
        u: (state.handle || "Anonymous patron").slice(0, 24), t: "", r: val, ts: Date.now(),
      }, user);
    }
    setState(s => ({
      ...s,
      predictions: s.predictions.map(q => q.filmId === p.filmId && q.actual == null ? { ...q, actual: val } : q),
      films: s.films.map(f2 => f2.id === p.filmId ? { ...f2, status: "watched", rating: val } : f2),
      spins: p.fromSpin ? { ...s.spins, honored: s.spins.honored + 1 } : s.spins,
    }));
  };

  if (open.length === 0 && done.length === 0) return null;

  return (
    <div className="nol-fade" style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      {open.length > 0 && (
        <Panel title="Open calls" right="settle after you watch">
          {open.map((p, i) => {
            const f = state.films.find(x => x.id === p.filmId);
            if (!f) return null;
            return (
              <div key={p.filmId} style={{
                display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
                padding: "12px 0", borderBottom: i < open.length - 1 ? `1px solid ${C.edge}` : "none",
              }}>
                <div style={{ flex: 1, minWidth: 170 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{f.n}</div>
                  <div style={{ color: C.muted, fontSize: 13 }}>
                    You called <span style={{ color: C.amber, fontWeight: 700 }}>{p.pred.toFixed(1)}</span>
                  </div>
                </div>
                <input type="range" className="nol-range" min="1" max="10" step="0.5"
                  value={rateVal[p.filmId] != null ? rateVal[p.filmId] : 7.5}
                  onChange={e => setRateVal(v => ({ ...v, [p.filmId]: Number(e.target.value) }))}
                  style={{ width: 130 }} />
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: C.red, width: 38 }}>
                  {(rateVal[p.filmId] != null ? rateVal[p.filmId] : 7.5).toFixed(1)}
                </span>
                <button className="nol-btn" onClick={() => rate(p)}>Watched</button>
              </div>
            );
          })}
        </Panel>
      )}

      {done.length > 0 && (
        <Panel title="Your track record" right={`${done.length} calls settled · avg miss ${avgGap.toFixed(1)}`}>
          {[...done].reverse().slice(0, 12).map((p, idx) => {
            const f = state.films.find(x => x.id === p.filmId);
            if (!f) return null;
            const gap = p.actual - p.pred;
            const dead = Math.abs(gap) <= 0.5;
            const verdict = dead ? "Dead on" : gap < 0 ? `Overhyped by ${Math.abs(gap).toFixed(1)}` : `Surprised you by ${gap.toFixed(1)}`;
            return (
              <div key={idx} style={{
                display: "flex", gap: 12, padding: "9px 0", fontSize: 14, alignItems: "baseline", flexWrap: "wrap",
                borderBottom: `1px solid ${C.edge}`,
              }}>
                <span style={{ fontWeight: 700, flex: 1, minWidth: 150 }}>{f.n}</span>
                <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13, color: C.muted }}>
                  called {p.pred.toFixed(1)} → rated {p.actual.toFixed(1)}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 700, letterSpacing: 0.5, borderRadius: 4, padding: "2px 10px",
                  color: dead ? "#0E2A1E" : gap < 0 ? C.paper : "#2A1F05",
                  background: dead ? C.green : gap < 0 ? C.red : C.amber,
                }}>{verdict}</span>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}

// ---------------- The board: face-offs + rankings + lobbies, one page ----------------
