import React, { useState, useEffect } from "react";
import { cloud } from "../lib/supabaseClient.js";
import { omdb } from "../lib/tmdb.js";
import { NO_SYN, C } from "../lib/constants.js";
import { postToLobby } from "../lib/utils.js";
import { SectionHead, RatingSlider } from "./Shared.jsx";
import { Lobby } from "./Lobby.jsx";

export function NightFlow({ state, setState, user, gated, goSignup }) {
  const night = state.night;
  const film = state.films.find(f => f.id === night.filmId);
  const [predVal, setPredVal] = useState(7.5);
  const [finalVal, setFinalVal] = useState(7.5);
  const [note, setNote] = useState("");
  // Rotten Tomatoes / IMDb / Metacritic only load once your prediction is locked in
  // (stage moves past "prerate") — so critic scores can never bias your honest guess.
  const [extRatings, setExtRatings] = useState(null);
  useEffect(() => {
    if (!film || night.stage === "prerate") { setExtRatings(null); return; }
    let on = true;
    omdb.getRatings(film.n, film.y).then(r => { if (on) setExtRatings(r); }).catch(() => { /* badges just won't show */ });
    return () => { on = false; };
  }, [film && film.id, night.stage === "prerate"]);
  if (!film) return null;

  const lockCall = () => {
    setState(s => ({
      ...s,
      predictions: [...s.predictions, { filmId: film.id, pred: predVal, actual: null, fromSpin: true }],
      night: { ...s.night, stage: "watching", pred: predVal },
    }));
  };

  const watched = () => setState(s => ({ ...s, night: { ...s.night, stage: "rate" } }));

  const settleRating = () => {
    const trimmed = note.trim();
    cloud.logEvent("rating_submitted", {});
    postToLobby(film, {
      u: (state.handle || "Anonymous patron").slice(0, 24),
      t: trimmed.slice(0, 500),
      r: finalVal,
      ts: Date.now(),
    }, user);
    setState(s => {
      const today = new Date().toISOString().slice(0, 10);
      const base = {
        ...s,
        predictions: s.predictions.map(q => q.filmId === film.id && q.actual == null ? { ...q, actual: finalVal } : q),
        films: s.films.map(f => f.id === film.id ? { ...f, status: "watched", rating: finalVal, note: trimmed } : f),
        spins: { ...s.spins, honored: s.spins.honored + 1 },
        nightLog: (s.nightLog || []).includes(today) ? (s.nightLog || []) : [...(s.nightLog || []), today].slice(-400),
      };
      if (gated) {
        return { ...base, night: { ...s.night, stage: "done", actual: finalVal, listPosition: null } };
      }
      const betterCount = base.films.filter(f => f.id !== film.id && f.rating != null && f.rating > finalVal).length;
      return { ...base, night: { ...s.night, stage: "done", actual: finalVal, listPosition: betterCount + 1 } };
    });
  };

  const cancelNight = () => {
    setState(s => ({
      ...s,
      predictions: s.predictions.filter(p => !(p.filmId === film.id && p.actual == null)),
      night: null,
    }));
  };

  const finish = () => setState(s => ({ ...s, night: null }));

  const frame = {
    position: "relative", background: C.panel, borderRadius: 12, marginBottom: 20,
    border: `2px solid ${C.amber}`, boxShadow: `0 0 40px rgba(255,182,39,0.22)`,
    padding: "38px 24px 32px", textAlign: "center",
  };
  const steps = ["Call it", "Watch", "Rate it"];
  const stepIdx = { prerate: 0, watching: 1, rate: 2, done: 2 }[night.stage];

  return (
    <div className="nol-fade" style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Movie night in progress" title={film.n}
        sub={`${film.y} · ${film.rt} min · dir. ${film.d} · streaming on ${film.svc}`} />

      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {steps.map((sName, i) => (
          <div key={sName} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.12em",
              padding: "5px 14px 3px", borderRadius: 999,
              background: i === stepIdx ? C.amber : i < stepIdx ? C.panelHi : "transparent",
              color: i === stepIdx ? "#14120A" : i < stepIdx ? C.green : C.faint,
              border: `1px solid ${i === stepIdx ? C.amber : C.edge}`,
            }}>{i < stepIdx ? "✓ " : ""}{sName}</span>
            {i < steps.length - 1 && <span style={{ color: C.faint }}>—</span>}
          </div>
        ))}
      </div>

      {night.stage === "prerate" && (
        <div style={frame}>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, marginBottom: 12 }}>
            Your pre-watch call
          </div>
          <p style={{
            color: C.muted, fontSize: 15, fontStyle: "italic", lineHeight: 1.6,
            maxWidth: 460, margin: "0 auto 16px",
          }}>
            {film.syn || NO_SYN}
          </p>
          <p style={{ color: C.muted, fontSize: 15, maxWidth: 420, margin: "0 auto 18px", lineHeight: 1.6 }}>
            What are you going to rate this? Lock it in now — no take-backs. Your calibration score is watching.
          </p>
          <RatingSlider value={predVal} onChange={setPredVal} />
          <div style={{ marginTop: 20 }}>
            <button className="nol-btn big" onClick={lockCall}>Lock my call — {predVal.toFixed(1)}</button>
          </div>
          <div style={{ marginTop: 14 }}>
            <span className="nol-danger-link" onClick={cancelNight}>Bail on tonight's pick (counts against your honor rate)</span>
          </div>
        </div>
      )}

      {night.stage === "watching" && (
        <div style={frame}>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 16 }} aria-hidden="true">
            {[...Array(9)].map((_, i) => (
              <span key={i} className="nol-bulb" style={{ animationDelay: `${(i % 3) * 0.3}s` }} />
            ))}
          </div>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: "0.2em", color: C.amber,
            animation: "nol-pulse 2.4s infinite",
          }}>NOW PLAYING</div>
          <p style={{ color: C.muted, fontSize: 15, maxWidth: 420, margin: "14px auto 6px", lineHeight: 1.6 }}>
            Your call of <span style={{ color: C.amber, fontWeight: 700 }}>{night.pred.toFixed(1)}</span> is on the record.
            Phones down, lights off. We'll be here when the credits roll.
          </p>
          {extRatings && (extRatings.rt || extRatings.imdb || extRatings.metacritic) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", margin: "4px 0 10px" }}>
              {extRatings.rt && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                  color: "#FF9C6B", border: `1px solid ${C.edge}`, borderRadius: 999, padding: "4px 12px",
                }}>🍅 {extRatings.rt}</span>
              )}
              {extRatings.imdb && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                  color: "#F5C518", border: `1px solid ${C.edge}`, borderRadius: 999, padding: "4px 12px",
                }}>★ IMDb {extRatings.imdb}</span>
              )}
              {extRatings.metacritic && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                  color: C.green, border: `1px solid ${C.edge}`, borderRadius: 999, padding: "4px 12px",
                }}>Metacritic {extRatings.metacritic}</span>
              )}
            </div>
          )}
          <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 12, color: C.faint, margin: "0 0 20px" }}>
            — intermission mode: this screen waits as long as it takes —
          </p>
          <button className="nol-btn big" onClick={watched}>Watched</button>
          <div style={{ marginTop: 14 }}>
            <span className="nol-danger-link" onClick={cancelNight}>Bail on tonight's pick (counts against your honor rate)</span>
          </div>
        </div>
      )}

      {night.stage === "rate" && (
        <div style={frame}>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, marginBottom: 12 }}>The verdict</div>
          <p style={{ color: C.muted, fontSize: 15, maxWidth: 420, margin: "0 auto 18px", lineHeight: 1.6 }}>
            You called <span style={{ color: C.amber, fontWeight: 700 }}>{night.pred.toFixed(1)}</span> before watching.
            Now the real number — how was it?
          </p>
          <RatingSlider value={finalVal} onChange={setFinalVal} color={C.red} />
          <div style={{ maxWidth: 440, margin: "18px auto 0" }}>
            <textarea className="nol-input" rows={3} value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Your take — it gets posted to this film's screening room for other patrons to see (optional)"
              style={{ resize: "vertical", fontFamily: "'Karla', sans-serif" }} />
          </div>
          <div style={{ marginTop: 18 }}>
            <button className="nol-btn big" onClick={settleRating}>Settle it — {finalVal.toFixed(1)}</button>
          </div>
        </div>
      )}

      {night.stage === "done" && (() => {
        const gap = night.actual - night.pred;
        const dead = Math.abs(gap) <= 0.5;
        const verdict = dead ? "Dead-on call" : gap < 0 ? `Overhyped it by ${Math.abs(gap).toFixed(1)}` : `It surprised you by ${gap.toFixed(1)}`;
        return (
          <div style={frame}>
            <div style={{
              position: "absolute", top: 12, right: 16, animation: "nol-stamp 0.4s ease both",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.15em",
              color: C.green, border: `3px solid ${C.green}`, borderRadius: 6, padding: "4px 14px 2px",
              transform: "rotate(-8deg)", background: "rgba(67,192,136,0.08)",
            }}>Night complete</div>
            <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, marginBottom: 14 }}>The results are in</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(34px, 7vw, 52px)", letterSpacing: "0.05em", lineHeight: 1.05 }}>
              {night.listPosition != null
                ? <>{film.n} lands at <span style={{ color: C.amber, textShadow: `0 0 20px rgba(255,182,39,0.5)` }}>#{night.listPosition}</span></>
                : <>{film.n} is on the record</>}
            </div>
            <p style={{ color: C.muted, fontSize: 15, margin: "14px 0 4px" }}>
              You called {night.pred.toFixed(1)} — you rated it {night.actual.toFixed(1)}.
            </p>
            <div style={{
              display: "inline-block", margin: "8px 0 12px", fontSize: 13, fontWeight: 700,
              color: dead ? "#0E2A1E" : gap < 0 ? C.paper : "#2A1F05",
              background: dead ? C.green : gap < 0 ? C.red : C.amber,
              borderRadius: 999, padding: "5px 16px",
            }}>{verdict}</div>
            {night.listPosition != null ? (
              <p style={{ color: C.faint, fontSize: 13, margin: "0 0 18px" }}>
                That's your rank on the Rating List. Your take also landed in the film's screening room in The Lobby.
              </p>
            ) : (
              <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, maxWidth: 400, margin: "0 auto 18px" }}>
                Want to see your Rating List and talk about it with the community? Create a free account
                to unlock your Rating List, The Lobby, and sync across your devices.
              </p>
            )}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              {night.listPosition == null && <button className="nol-btn big" onClick={goSignup}>Create an account</button>}
              <button className={night.listPosition == null ? "nol-ghost" : "nol-btn big"} onClick={finish}>Back to the marquee</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------- Trending strip: what's new this week ----------------
