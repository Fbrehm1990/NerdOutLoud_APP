import React, { useState, useEffect, useRef } from "react";
import { cloud } from "../lib/supabaseClient.js";
import { tmdb } from "../lib/tmdb.js";
import { C } from "../lib/constants.js";
import { slugify } from "../lib/utils.js";
import { SectionHead, Panel } from "./Shared.jsx";
import { Lobby } from "./Lobby.jsx";
import { PatronBoard } from "./CommunityFeatures.jsx";

export function BoardPage({ state, setState, user, goAccount, jumpFilmId, clearJump }) {
  const [expandedId, setExpandedId] = useState(jumpFilmId || null);
  const [pulse, setPulse] = useState(null);
  const [communityRatings, setCommunityRatings] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!jumpFilmId) return;
    setExpandedId(jumpFilmId);
    const el = document.getElementById("nol-film-" + jumpFilmId);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    if (clearJump) clearJump();
  }, [jumpFilmId]);

  const refreshCommunity = () => {
    if (!cloud.enabled()) return;
    cloud.loadCommunityRatings(300).then(rows => { if (rows) setCommunityRatings(rows); }).catch(() => { /* quiet */ });
  };

  useEffect(() => {
    if (!cloud.enabled()) return;
    let on = true;
    cloud.recentLobby().then(rows => { if (on && rows) setPulse(rows); }).catch(() => { /* quiet */ });
    cloud.loadCommunityRatings(300).then(rows => { if (on && rows) setCommunityRatings(rows); }).catch(() => { /* quiet */ });
    return () => { on = false; };
  }, []);

  const communityBySlug = {};
  (communityRatings || []).forEach(row => { communityBySlug[row.slug] = row; });

  // Merge your own library with any community-rated films you don't have locally yet,
  // so The Lobby's ranking reflects everyone, not just what happens to be in your library.
  const librarySlug = new Set(state.films.map(f => slugify(f.n)));
  const extras = (communityRatings || [])
    .filter(row => !librarySlug.has(row.slug))
    .map(row => ({
      __synthetic: true, __slug: row.slug,
      n: row.name, y: row.year || new Date().getFullYear(), d: row.director || "Unknown",
      rt: 110, mood: "drama", svc: "Other", status: "watchlist", rating: null, poster: row.poster || null,
    }));
  const merged = [...state.films, ...extras];

  const allFilms = [...merged].sort((a, b) => {
    const ca = communityBySlug[slugify(a.n)], cb = communityBySlug[slugify(b.n)];
    const aScore = ca ? ca.avg_rating : null, bScore = cb ? cb.avg_rating : null;
    if (aScore != null && bScore != null) return bScore - aScore || a.n.localeCompare(b.n);
    if (aScore != null) return -1;
    if (bScore != null) return 1;
    if (a.rating != null && b.rating != null) return b.rating - a.rating || a.n.localeCompare(b.n);
    if (a.rating != null) return -1;
    if (b.rating != null) return 1;
    return a.n.localeCompare(b.n);
  });

  // Background-fetch a poster for any real library film that doesn't have one yet.
  const [posterBusy, setPosterBusy] = useState(false);
  useEffect(() => {
    if (!tmdb.enabled() || posterBusy) return;
    const next = state.films.find(f => !f.poster);
    if (!next) return;
    setPosterBusy(true);
    tmdb.search(next.n).then(rows => {
      if (rows && rows[0] && rows[0].poster_path) setFilmPoster(next.id, rows[0].poster_path);
    }).catch(() => { /* no poster found, placeholder stays */ }).finally(() => setPosterBusy(false));
  }, [state.films.map(f => f.id + (f.poster ? "1" : "0")).join(","), posterBusy]);

  const saveHandle = (h) => setState(s => ({ ...s, handle: h }));
  const setFilmPoster = (filmId, poster) => setState(s => ({
    ...s, films: s.films.map(f => f.id === filmId ? { ...f, poster } : f),
  }));
  // Rating a film from inside its lobby should immediately reflect on "My Ranking"
  // and in Library, the same as rating it through any other flow in the app.
  const setFilmRating = (filmId, rating) => setState(s => ({
    ...s, films: s.films.map(f => f.id === filmId ? { ...f, status: "watched", rating } : f),
  }));

  // A community-rated film might not be in this visitor's own library yet — if not,
  // add it (as a watchlist entry) so its lobby can open just like any other film.
  const openFilm = (f) => {
    if (!f.__synthetic) { setExpandedId(expandedId === f.id ? null : f.id); return; }
    const newId = state.nextId;
    setState(s => ({
      ...s, nextId: newId + 1,
      films: [...s.films, {
        id: newId, n: f.n, y: f.y, d: f.d, rt: f.rt, mood: f.mood, svc: f.svc,
        status: "watchlist", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "", poster: f.poster || null,
      }],
    }));
    setExpandedId(newId);
  };

  // Search for any movie to jump straight to its screening room — even ones
  // nobody's added or rated yet. Reuses openFilm's existing materialize-or-open logic.
  const onSearchChange = (val) => {
    setSearchQ(val);
    setShowResults(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.trim().length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await tmdb.search(val.trim());
        setSearchResults(rows || []);
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 400);
  };

  const pickSearchResult = (row) => {
    const title = row.title || row.name || "Untitled";
    const existing = state.films.find(f => slugify(f.n) === slugify(title));
    const shaped = existing || {
      __synthetic: true, __slug: slugify(title),
      n: title, y: row.release_date ? Number(row.release_date.slice(0, 4)) : new Date().getFullYear(),
      d: "Unknown", rt: 110, mood: "drama", svc: "Other", poster: row.poster_path || null,
    };
    openFilm(shaped);
    setSearchQ(""); setSearchResults([]); setShowResults(false);
  };

  return (
    <div className="nol-fade" style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Now showing" title="The Lobby"
        sub="See the User Ranking and your own My Ranking side by side. Tap any film to talk about it — your full ranked list lives in Library." />

      <div style={{ position: "relative", marginBottom: 20 }}>
        <input className="nol-input" placeholder="Search for a movie to review…" value={searchQ}
          onChange={e => onSearchChange(e.target.value)}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)} />
        {showResults && searchQ.trim().length >= 2 && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 5,
            background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 8,
            maxHeight: 340, overflowY: "auto", boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}>
            {searching && <p style={{ color: C.faint, fontSize: 13, padding: "12px 14px", margin: 0 }}>Searching…</p>}
            {!searching && searchResults.length === 0 && (
              <p style={{ color: C.faint, fontSize: 13, padding: "12px 14px", margin: 0 }}>No matches found.</p>
            )}
            {!searching && searchResults.map(row => (
              <div key={row.id} onMouseDown={() => pickSearchResult(row)} className="nol-row" style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer",
              }}>
                {row.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w92${row.poster_path}`} alt=""
                    style={{ width: 34, height: 51, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 34, height: 51, borderRadius: 3, background: C.panelHi, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.title || row.name}
                  </div>
                  <div style={{ fontSize: 11, color: C.faint }}>
                    {row.release_date ? row.release_date.slice(0, 4) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, margin: "22px 0 8px" }}>
        Ranked by everyone's ratings — tap one to talk
      </div>
      <div style={{
        background: C.panel, border: `2px solid ${C.edge}`, borderRadius: 10,
        overflow: "hidden", boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      }}>
        {allFilms.map((f, i) => {
          const cr = communityBySlug[slugify(f.n)];
          const hasRank = cr != null || f.rating != null;
          const isExpanded = !f.__synthetic && expandedId === f.id;
          return (
            <React.Fragment key={f.__synthetic ? "cr-" + f.__slug : f.id}>
              <div id={f.__synthetic ? undefined : "nol-film-" + f.id} className="nol-row nol-media-row" onClick={() => openFilm(f)}
                style={{
                  padding: "10px 16px", cursor: "pointer",
                  borderBottom: isExpanded ? "none" : `1px solid ${C.edge}`,
                }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  {f.poster ? (
                    <img src={`https://image.tmdb.org/t/p/w154${f.poster}`} alt=""
                      style={{ width: 52, height: 78, objectFit: "cover", borderRadius: 5, display: "block", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }} />
                  ) : (
                    <div style={{
                      width: 52, height: 78, borderRadius: 5, background: C.panelHi,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}>
                      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: C.faint }}>{f.n[0]}</span>
                    </div>
                  )}
                  {hasRank && (
                    <span style={{
                      position: "absolute", top: -6, left: -6, fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 13, minWidth: 22, textAlign: "center", borderRadius: 999, padding: "2px 5px 0",
                      background: i === 0 ? C.amber : C.bg, color: i === 0 ? "#14120A" : C.amberSoft,
                      border: i === 0 ? "none" : `1px solid ${C.edge}`,
                      boxShadow: i === 0 ? "0 0 10px rgba(255,182,39,0.6)" : "0 2px 6px rgba(0,0,0,0.4)",
                    }}>{i === 0 ? "★" : i + 1}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 21, letterSpacing: "0.05em",
                    color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{f.n}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                    {f.y}{f.d && f.d !== "Unknown" ? ` · dir. ${f.d}` : ""}
                  </div>
                  {!cr && f.rating == null && (
                    <div style={{ fontFamily: "'Courier Prime', monospace", fontSize: 12, color: C.faint, marginTop: 5 }}>
                      {f.__synthetic ? "rated by the community — tap to join in" : f.status === "watchlist" ? "on your watchlist" : "not yet rated"}
                    </div>
                  )}
                </div>
                {(cr || f.rating != null) && (
                  <div className="nol-media-badges">
                    {cr && (
                      <div style={{ textAlign: "center", minWidth: 42 }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, whiteSpace: "nowrap" }}>User Ranking</div>
                        <div style={{
                          fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: C.amber,
                          textShadow: "0 0 10px rgba(255,182,39,0.3)", lineHeight: 1.1,
                        }}>{Number(cr.avg_rating).toFixed(1)}</div>
                        <div style={{ fontSize: 9, color: C.faint }}>{cr.rating_count} rating{cr.rating_count === 1 ? "" : "s"}</div>
                      </div>
                    )}
                    {f.rating != null && (
                      <div style={{ textAlign: "center", minWidth: 42 }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, whiteSpace: "nowrap" }}>My Ranking</div>
                        <div style={{
                          fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: C.green, lineHeight: 1.1,
                        }}>{f.rating.toFixed(1)}</div>
                      </div>
                    )}
                  </div>
                )}
                <span style={{ color: isExpanded ? C.amber : C.faint, fontSize: 12, flexShrink: 0 }}>
                  {isExpanded ? "▾" : "▸"}
                </span>
              </div>
              {isExpanded && (
                <div style={{ padding: "0 16px 4px", borderBottom: i < allFilms.length - 1 ? `1px solid ${C.edge}` : "none" }}>
                  <Lobby film={f} handle={state.handle} saveHandle={saveHandle} user={user} goAccount={goAccount} setFilmPoster={setFilmPoster} onRate={setFilmRating} refreshCommunity={refreshCommunity} />
                </div>
              )}
            </React.Fragment>
          );
        })}
        {allFilms.length === 0 && <p style={{ color: C.muted, textAlign: "center", padding: 20 }}>Nothing rated yet — be the first.</p>}
      </div>
      <p style={{ textAlign: "center", color: C.faint, fontSize: 12, marginTop: 12, letterSpacing: "0.15em", textTransform: "uppercase" }}>
        {allFilms.length} films · tap one to enter its lobby
      </p>

      {cloud.enabled() && pulse && pulse.length > 0 && (
        <Panel title="Now talking" right="latest takes across all lobbies">
          {pulse.slice(0, 8).map((p, i) => {
            const f = allFilms.find(x => slugify(x.n) === p.film_slug);
            const shown = Math.min(pulse.length, 8);
            return (
              <div key={i} onClick={() => f && openFilm(f)} style={{
                padding: "8px 0", cursor: f ? "pointer" : "default",
                borderBottom: i < shown - 1 ? `1px solid ${C.edge}` : "none",
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{p.handle}</span>
                  <span style={{ fontSize: 12, color: C.faint }}>on</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: f ? C.amber : C.muted, textTransform: "capitalize" }}>
                    {f ? f.n : p.film_slug.replace(/-/g, " ")}
                  </span>
                  {p.rating != null && (
                    <span style={{
                      fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: "#14120A",
                      background: C.amber, borderRadius: 3, padding: "1px 7px 0",
                    }}>{Number(p.rating).toFixed(1)}</span>
                  )}
                  <span style={{ fontSize: 11, color: C.faint, marginLeft: "auto" }}>
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}
                  </span>
                </div>
                {p.body && (
                  <div style={{ color: C.muted, fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.body}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      )}

      <PatronBoard user={user} handle={state.handle} goAccount={goAccount} />
    </div>
  );
}

// ---------------- Live movie search (TMDB) ----------------
