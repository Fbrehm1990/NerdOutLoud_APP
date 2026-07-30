import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { cloud } from "../lib/supabaseClient.js";
import { tmdb } from "../lib/tmdb.js";
import { C } from "../lib/constants.js";
import { SectionHead } from "./Shared.jsx";

export function TrendingStrip({ items, live, onPick, theaterIds, upcomingIds, onOverview, onTrailer, onTickets, onReleaseDate }) {
  const [revealedId, setRevealedId] = useState(null);
  if (!items || !items.length) return null;
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber }}>
          New & trending this week
        </span>
        <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>
          {live ? "live from TMDB · tap to pick" : "tap to pick"}
        </span>
      </div>
      <div className="nol-trend-row">
        {items.map((t, i) => {
          const inTheaters = theaterIds && t.tmdbId && theaterIds.has(t.tmdbId);
          const comingSoon = !inTheaters && upcomingIds && t.tmdbId && upcomingIds.has(t.tmdbId);
          const special = inTheaters || comingSoon;
          const revealed = revealedId === (t.tid || t.n);
          return (
            <div key={t.tid || t.n} className={`nol-trend-card${special ? " nol-theater-card" : ""}`}
              onClick={() => {
                if (!special) { onPick(t, i + 1); return; }
                setRevealedId(revealed ? null : (t.tid || t.n));
              }}
              role="button" tabIndex={0} aria-label={t.n}>
              {t.poster ? (
                <img src={`https://image.tmdb.org/t/p/w185${t.poster}`} alt=""
                  style={{ width: "100%", height: 156, objectFit: "cover", borderRadius: 6, display: "block", boxShadow: "0 4px 14px rgba(0,0,0,0.45)" }} />
              ) : (
                <div style={{
                  width: "100%", height: 156, borderRadius: 6, background: C.panelHi,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 8,
                  boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
                }}>
                  <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 1, color: C.muted, textAlign: "center", lineHeight: 1.1 }}>{t.n}</span>
                </div>
              )}
              <div style={{
                position: "absolute", top: 6, left: 6, fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 13, background: C.amber, color: "#14120A", borderRadius: 4, padding: "2px 7px 0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}>#{i + 1}</div>
              {inTheaters && (
                <div style={{
                  position: "absolute", top: 6, right: 6, fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 10, letterSpacing: "0.05em", background: C.red, color: C.paper, borderRadius: 4, padding: "2px 6px 0",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                }}>IN THEATERS</div>
              )}
              {comingSoon && (
                <div style={{
                  position: "absolute", top: 6, right: 6, fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 10, letterSpacing: "0.05em", background: C.green, color: "#0E2A1E", borderRadius: 4, padding: "2px 6px 0",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                }}>COMING SOON</div>
              )}
              {special && (
                <div className={`nol-theater-overlay${revealed ? " revealed" : ""}`}>
                  <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onOverview(t); }}>Overview</button>
                  <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onTrailer(t); }}>Trailer</button>
                  {inTheaters ? (
                    <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onTickets(t); }}>Buy Tickets</button>
                  ) : (
                    <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onReleaseDate(t); }}>Release Date</button>
                  )}
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.n}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{t.y} · {inTheaters ? "in theaters" : comingSoon ? "coming soon" : t.svc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A small, focused modal shell shared by the three theater actions — rendered via
// a portal straight to <body>, so it's never trapped inside an ancestor's transform
// (an animated parent element can silently break position:fixed otherwise).
export function TheaterModalShell({ onClose, children, width }) {
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(5,6,14,0.82)" }} />
      <div className="nol-fade" style={{
        position: "relative", width: width || "min(420px, 92vw)", maxHeight: "88vh", overflowY: "auto",
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <button onClick={onClose} aria-label="Close" style={{
          position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: "50%",
          background: "rgba(13,15,30,0.85)", border: `1px solid ${C.edge}`, color: C.text, fontSize: 15, cursor: "pointer", zIndex: 1,
        }}>✕</button>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function OverviewModal({ film, onClose }) {
  const [details, setDetails] = useState(null);
  useEffect(() => {
    if (!film || !film.tmdbId) return;
    let on = true;
    tmdb.filmDetails(film.tmdbId).then(d => { if (on) setDetails(d); }).catch(() => {});
    return () => { on = false; };
  }, [film && film.tmdbId]);
  if (!film) return null;
  const overview = (details && details.overview) || film.syn || "";
  const cast = (details && details.credits && details.credits.cast) || [];
  const topCast = cast.slice(0, 6);
  return (
    <TheaterModalShell onClose={onClose}>
      {film.poster && <img src={`https://image.tmdb.org/t/p/w500${film.poster}`} alt="" style={{ width: "100%", display: "block", borderRadius: "12px 12px 0 0" }} />}
      <div style={{ padding: "18px 20px 22px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: "0.04em", color: C.text, lineHeight: 1.1 }}>{film.n}</div>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
          {film.y}{film.d && film.d !== "Unknown" ? ` · dir. ${film.d}` : ""}{film.rt ? ` · ${film.rt} min` : ""}
        </div>
        {overview ? (
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>{overview}</p>
        ) : (
          <p style={{ color: C.faint, fontSize: 13, marginTop: 12 }}>Loading synopsis…</p>
        )}
        {topCast.length > 0 && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.edge}`, paddingTop: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>
              Starring
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {topCast.map(c => (
                <span key={c.id || c.name} style={{
                  fontSize: 12, color: C.text, background: C.panelHi, border: `1px solid ${C.edge}`,
                  borderRadius: 999, padding: "4px 11px",
                }}>
                  {c.name}{c.character ? <span style={{ color: C.faint }}> · {c.character}</span> : null}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </TheaterModalShell>
  );
}

export function TrailerModal({ film, onClose }) {
  const [trailerKey, setTrailerKey] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!film || !film.tmdbId) return;
    let on = true;
    tmdb.trailerKey(film.tmdbId).then(k => { if (on) { setTrailerKey(k); setLoaded(true); } }).catch(() => { if (on) setLoaded(true); });
    return () => { on = false; };
  }, [film && film.tmdbId]);
  if (!film) return null;
  return (
    <TheaterModalShell onClose={onClose} width="min(640px, 92vw)">
      <div style={{ padding: "18px 20px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: C.text, marginBottom: 12 }}>{film.n} — Trailer</div>
        {trailerKey ? (
          <div style={{ position: "relative", paddingTop: "56.25%", background: "#000", borderRadius: 8, overflow: "hidden" }}>
            <iframe
              src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`}
              title="Trailer" allow="autoplay; encrypted-media" allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          </div>
        ) : loaded ? (
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, textAlign: "center", padding: "30px 10px" }}>
            No trailer on file for this one yet.
          </p>
        ) : (
          <p style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "30px 10px" }}>Loading trailer…</p>
        )}
      </div>
    </TheaterModalShell>
  );
}

export function TicketsModal({ film, onClose }) {
  if (!film) return null;
  const q = encodeURIComponent(film.n);
  return (
    <TheaterModalShell onClose={onClose}>
      <div style={{ padding: "20px 20px 22px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: C.text, marginBottom: 4 }}>{film.n}</div>
        <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, margin: "14px 0 10px" }}>
          Get tickets
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <a href={`https://www.fandango.com/search?q=${q}`} target="_blank" rel="noopener noreferrer" className="nol-btn" style={{ textDecoration: "none", textAlign: "center" }}>Fandango</a>
          <a href={`https://www.atomtickets.com/search?q=${q}`} target="_blank" rel="noopener noreferrer" className="nol-ghost" style={{ textDecoration: "none", textAlign: "center" }}>Atom Tickets</a>
          <a href={`https://www.amctheatres.com/search?q=${q}`} target="_blank" rel="noopener noreferrer" className="nol-ghost" style={{ textDecoration: "none", textAlign: "center" }}>AMC</a>
        </div>
        <p style={{ color: C.faint, fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
          These links take you to each site's own search results — REELmunity isn't affiliated with
          Fandango, Atom Tickets, or AMC, and doesn't process ticket purchases.
        </p>
      </div>
    </TheaterModalShell>
  );
}

export function ReleaseDateModal({ film, onClose }) {
  const [details, setDetails] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!film || !film.tmdbId) return;
    let on = true;
    tmdb.filmDetails(film.tmdbId).then(d => { if (on) { setDetails(d); setLoaded(true); } }).catch(() => { if (on) setLoaded(true); });
    return () => { on = false; };
  }, [film && film.tmdbId]);
  if (!film) return null;
  const raw = details && details.release_date;
  const formatted = raw ? new Date(raw + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : null;
  const daysAway = raw ? Math.ceil((new Date(raw + "T00:00:00") - new Date(new Date().toDateString())) / 86400000) : null;
  return (
    <TheaterModalShell onClose={onClose}>
      {film.poster && <img src={`https://image.tmdb.org/t/p/w500${film.poster}`} alt="" style={{ width: "100%", display: "block", borderRadius: "12px 12px 0 0" }} />}
      <div style={{ padding: "18px 20px 22px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: "0.04em", color: C.text, lineHeight: 1.1 }}>{film.n}</div>
        <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, margin: "16px 0 6px" }}>
          Coming to theaters
        </div>
        {formatted ? (
          <>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: C.amber, textShadow: "0 0 16px rgba(255,182,39,0.3)" }}>
              {formatted}
            </div>
            {daysAway != null && daysAway > 0 && (
              <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>{daysAway} day{daysAway === 1 ? "" : "s"} away</div>
            )}
          </>
        ) : loaded ? (
          <p style={{ color: C.muted, fontSize: 14 }}>No confirmed date on file yet.</p>
        ) : (
          <p style={{ color: C.faint, fontSize: 13 }}>Loading release date…</p>
        )}
      </div>
    </TheaterModalShell>
  );
}
