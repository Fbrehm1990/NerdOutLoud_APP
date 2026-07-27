import React, { useState, useEffect } from "react";
import { tmdb } from "../lib/tmdb.js";
import { C } from "../lib/constants.js";
import { SectionHead } from "./Shared.jsx";
import { OverviewModal, TrailerModal, TicketsModal, ReleaseDateModal } from "./TheaterFeatures.jsx";

export function TheaterPosterGrid({ items, badge, badgeColor, onOverview, onTrailer, onThird, thirdLabel, streamInfo }) {
  const [revealedId, setRevealedId] = useState(null);

  const formatDate = (iso) => {
    if (!iso) return null;
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="nol-theater-grid">
      {items.map(t => {
        const revealed = revealedId === t.tmdbId;
        const info = streamInfo && streamInfo[t.tmdbId];
        return (
          <div key={t.tmdbId} className="nol-trend-card nol-theater-card"
            onClick={() => setRevealedId(revealed ? null : t.tmdbId)}
            role="button" tabIndex={0} aria-label={`${t.n} — choose an option`}
            style={{ width: "auto" }}>
            {t.poster ? (
              <img src={`https://image.tmdb.org/t/p/w185${t.poster}`} alt=""
                style={{ width: "100%", height: 195, objectFit: "cover", borderRadius: 6, display: "block", boxShadow: "0 4px 14px rgba(0,0,0,0.45)" }} />
            ) : (
              <div style={{
                width: "100%", height: 195, borderRadius: 6, background: C.panelHi,
                display: "flex", alignItems: "center", justifyContent: "center", padding: 8,
                boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
              }}>
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 1, color: C.muted, textAlign: "center", lineHeight: 1.1 }}>{t.n}</span>
              </div>
            )}
            <div style={{
              position: "absolute", top: 6, right: 6, fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 10, letterSpacing: "0.05em", background: badgeColor, color: badgeColor === C.green ? "#0E2A1E" : C.paper,
              borderRadius: 4, padding: "2px 6px 0", boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}>{badge}</div>
            <div className={`nol-theater-overlay${revealed ? " revealed" : ""}`}>
              <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onOverview(t); }}>Overview</button>
              <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onTrailer(t); }}>Trailer</button>
              <button className="nol-theater-opt" onClick={(e) => { e.stopPropagation(); onThird(t); }}>{thirdLabel}</button>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.n}</div>
            <div style={{ fontSize: 11, color: C.faint }}>{t.y}</div>
            {info && info.svc && (
              <div style={{
                marginTop: 4, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                color: C.green, background: "rgba(67,192,136,0.12)", border: `1px solid ${C.green}`,
                borderRadius: 4, padding: "2px 6px", display: "inline-block",
              }}>Streaming on {info.svc}</div>
            )}
            {info && info.date && (
              <div style={{
                marginTop: 4, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                color: C.amberSoft, background: "rgba(255,182,39,0.1)", border: `1px solid ${C.edge}`,
                borderRadius: 4, padding: "2px 6px", display: "inline-block",
              }}>Streams {formatDate(info.date)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TheatersPage() {
  const [nowPlaying, setNowPlaying] = useState(null);
  const [upcomingTheatrical, setUpcomingTheatrical] = useState(null);
  const [upcomingStream, setUpcomingStream] = useState(null);
  const [streamSvcInfo, setStreamSvcInfo] = useState({});
  const [tab, setTab] = useState("now");
  const [theaterFilm, setTheaterFilm] = useState(null);
  const [theaterMode, setTheaterMode] = useState(null);

  useEffect(() => {
    if (!tmdb.enabled()) return;
    let on = true;
    tmdb.nowPlayingList().then(items => { if (on) setNowPlaying(items); }).catch(() => { if (on) setNowPlaying([]); });
    tmdb.upcomingList().then(items => { if (on) setUpcomingTheatrical(items); }).catch(() => { if (on) setUpcomingTheatrical([]); });
    tmdb.upcomingStreamList().then(items => { if (on) setUpcomingStream(items); }).catch(() => { if (on) setUpcomingStream([]); });
    return () => { on = false; };
  }, []);

  // Which service each upcoming streaming title is headed to, so the badge can say
  // "Streaming on Netflix" instead of just "coming soon" — fetched only for this
  // smaller, already-correctly-filtered list, not the whole catalog.
  useEffect(() => {
    if (!upcomingStream || !upcomingStream.length) return;
    let on = true;
    (async () => {
      const info = {};
      const BATCH = 6;
      for (let i = 0; i < upcomingStream.length; i += BATCH) {
        if (!on) return;
        const batch = upcomingStream.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(t => tmdb.streamingInfo(t.tmdbId).catch(() => ({ svc: null, date: null }))));
        batch.forEach((t, j) => { info[t.tmdbId] = results[j]; });
        setStreamSvcInfo(prev => ({ ...prev, ...info }));
      }
    })();
    return () => { on = false; };
  }, [upcomingStream && upcomingStream.map(t => t.tmdbId).join(",")]);

  const openOverview = (t) => { cloud.logEvent("theater_action", { action: "overview" }); setTheaterFilm(t); setTheaterMode("overview"); };
  const openTrailer = (t) => { cloud.logEvent("theater_action", { action: "trailer" }); setTheaterFilm(t); setTheaterMode("trailer"); };
  const openTickets = (t) => { cloud.logEvent("theater_action", { action: "tickets" }); setTheaterFilm(t); setTheaterMode("tickets"); };
  const openRelease = (t) => { cloud.logEvent("theater_action", { action: "release" }); setTheaterFilm(t); setTheaterMode("release"); };

  const comingCount = (upcomingTheatrical && upcomingStream) ? upcomingTheatrical.length + upcomingStream.length : null;
  const list = tab === "now" ? nowPlaying : (upcomingTheatrical && upcomingStream ? [...upcomingTheatrical, ...upcomingStream] : null);

  return (
    <div className="nol-fade" style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Now showing" title="In Theaters"
        sub="Everything currently playing and coming soon — overview, trailer, and tickets, without hunting through the trending strip." />

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <button className={`nol-seg${tab === "now" ? " on" : ""}`} onClick={() => setTab("now")}>
          Playing now {nowPlaying ? `· ${nowPlaying.length}` : ""}
        </button>
        <button className={`nol-seg${tab === "coming" ? " on" : ""}`} onClick={() => setTab("coming")}>
          Coming soon {comingCount != null ? `· ${comingCount}` : ""}
        </button>
      </div>

      {list === null && <p style={{ color: C.faint, textAlign: "center", padding: 30 }}>Loading…</p>}
      {list && list.length === 0 && <p style={{ color: C.muted, textAlign: "center", padding: 30 }}>Nothing on file right now — check back soon.</p>}

      {tab === "now" && list && list.length > 0 && (
        <TheaterPosterGrid items={list} badge="IN THEATERS" badgeColor={C.red}
          onOverview={openOverview} onTrailer={openTrailer} onThird={openTickets} thirdLabel="Buy Tickets" />
      )}

      {tab === "coming" && upcomingTheatrical && upcomingStream && (
        <>
          {upcomingTheatrical.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(22px, 5vw, 30px)", letterSpacing: "0.06em",
                  color: C.amber, textShadow: "0 0 22px rgba(255,182,39,0.4)",
                }}>
                  🎬 Coming Soon to a Theatre Near You
                </div>
                <div style={{ width: 70, height: 3, background: C.amber, borderRadius: 2, margin: "8px auto 0", boxShadow: "0 0 10px rgba(255,182,39,0.6)" }} />
              </div>
              <TheaterPosterGrid items={upcomingTheatrical} badge="COMING SOON" badgeColor={C.green}
                onOverview={openOverview} onTrailer={openTrailer} onThird={openRelease} thirdLabel="Release Date" />
            </div>
          )}
          {upcomingStream.length > 0 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(22px, 5vw, 30px)", letterSpacing: "0.06em",
                  color: C.green, textShadow: "0 0 22px rgba(67,192,136,0.4)",
                }}>
                  📺 Coming Soon to Stream
                </div>
                <div style={{ width: 70, height: 3, background: C.green, borderRadius: 2, margin: "8px auto 0", boxShadow: "0 0 10px rgba(67,192,136,0.6)" }} />
              </div>
              <TheaterPosterGrid items={upcomingStream} badge="COMING SOON" badgeColor={C.green} streamInfo={streamSvcInfo}
                onOverview={openOverview} onTrailer={openTrailer} onThird={openRelease} thirdLabel="Release Date" />
            </div>
          )}
        </>
      )}

      {theaterFilm && theaterMode === "overview" && <OverviewModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
      {theaterFilm && theaterMode === "trailer" && <TrailerModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
      {theaterFilm && theaterMode === "tickets" && <TicketsModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
      {theaterFilm && theaterMode === "release" && <ReleaseDateModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
    </div>
  );
}
