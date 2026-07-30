import React, { useState, useEffect, useRef } from "react";
import { cloud } from "../lib/supabaseClient.js";
import { TMDB_PROVIDERS, tmdb } from "../lib/tmdb.js";
import { ALL_SERVICES, TRENDING, CATALOG, NO_SYN, C, MOODS } from "../lib/constants.js";
import { slugify, calStats, computeStreak, tasteProfile, weightedPick, postToLobby } from "../lib/utils.js";
import { SectionHead, Stat, RatingSlider, DualRangeSlider } from "./Shared.jsx";
import { TrendingStrip, OverviewModal, TrailerModal, TicketsModal, ReleaseDateModal } from "./TheaterFeatures.jsx";
import { trackFirstSpinConversion } from "../lib/googleAds.js";

export function Picker({ state, setState, user }) {
  const [source, setSource] = useState("taste");
  const [mood, setMood] = useState("any");
  const [maxRt, setMaxRt] = useState(150);
  const [phase, setPhase] = useState("idle");
  const [display, setDisplay] = useState(null);
  const [why, setWhy] = useState("");
  const vetoes = state.vetoesLeft != null ? state.vetoesLeft : 2;
  const [minYr, setMinYr] = useState(1920);
  const [maxYr, setMaxYr] = useState(2025);
  const [contentRating, setContentRating] = useState("any");
  const [seenMode, setSeenMode] = useState(false);
  const [seenRating, setSeenRating] = useState(7.5);
  const [seenNote, setSeenNote] = useState("");
  const [liveTrending, setLiveTrending] = useState(null);
  const [liveCatalog, setLiveCatalog] = useState({});   // { "Netflix::any": [...], "Netflix::PG-13": [...] }
  const [loadingSvcs, setLoadingSvcs] = useState({});
  const [communityRatings, setCommunityRatings] = useState(null);
  const [theaterIds, setTheaterIds] = useState(null);
  const [upcomingIds, setUpcomingIds] = useState(null);
  const [theaterFilm, setTheaterFilm] = useState(null);
  const [theaterMode, setTheaterMode] = useState(null); // "overview" | "trailer" | "tickets" | "release"
  const timer = useRef(null);

  // Which trending titles are still in theaters, or not out yet — those get a
  // detail view (overview, trailer, tickets/release date) instead of a movie night.
  useEffect(() => {
    if (!tmdb.enabled()) return;
    let on = true;
    tmdb.nowPlayingIds().then(ids => { if (on) setTheaterIds(ids); }).catch(() => { /* quiet */ });
    tmdb.upcomingIds().then(ids => { if (on) setUpcomingIds(ids); }).catch(() => { /* quiet */ });
    return () => { on = false; };
  }, []);

  // Loaded once — lets the landed card show "The Lobby rates it 8.2" without
  // any extra clicks or navigation, straight from the same data The Lobby uses.
  useEffect(() => {
    if (!cloud.enabled()) return;
    let on = true;
    cloud.loadCommunityRatings(500).then(rows => { if (on && rows) setCommunityRatings(rows); }).catch(() => { /* quiet */ });
    return () => { on = false; };
  }, []);
  const communityFor = (filmName) => {
    if (!communityRatings) return null;
    const s = slugify(filmName);
    return communityRatings.find(r => r.slug === s) || null;
  };

  useEffect(() => {
    if (!tmdb.enabled()) return;
    let on = true;
    tmdb.trending().then(items => { if (on && items && items.length) setLiveTrending(items); }).catch(() => { /* fall back to built-in */ });
    return () => { on = false; };
  }, []);

  // Background-fetch each selected service's live streaming catalog from TMDB,
  // one service at a time so we're not firing a burst of requests at once.
  // Keyed by service+rating so switching the content rating filter re-fetches
  // the correctly-filtered list instead of reusing an unrelated cache.
  useEffect(() => {
    if (!tmdb.enabled()) return;
    let on = true;
    const svcs = state.services || [];
    const keyFor = (s) => `${s}::${contentRating}`;
    const next = svcs.find(s => TMDB_PROVIDERS[s] && !liveCatalog[keyFor(s)] && !loadingSvcs[keyFor(s)]);
    if (!next) return;
    const key = keyFor(next);
    setLoadingSvcs(p => ({ ...p, [key]: true }));
    tmdb.discoverByService(next, contentRating).then(items => {
      if (!on) return;
      setLiveCatalog(p => ({ ...p, [key]: items }));
    }).catch(() => { /* leave unfetched, curated catalog still covers it */ }).finally(() => {
      if (on) setLoadingSvcs(p => ({ ...p, [key]: false }));
    });
    return () => { on = false; };
  }, [state.services.join("|"), contentRating, Object.keys(liveCatalog).join("|")]);

  const services = state.services || [...ALL_SERVICES];
  const profile = tasteProfile(state.films);
  const ratingFiltered = contentRating !== "any";

  // Single source of truth for what's eligible, rebuilt fresh on every use so
  // a pick can never land outside your selected services or filters.
  const buildPool = () => {
    const svcs = state.services || [...ALL_SERVICES];
    const svcOk = (f) => svcs.includes(f.svc);
    const openIds = new Set(state.predictions.filter(p => p.actual == null).map(p => p.filmId));
    const libTitles = new Set(state.films.map(f => f.n.toLowerCase()));
    const watchedTitles = new Set(state.films.filter(f => f.status === "watched").map(f => f.n.toLowerCase()));

    // A content rating is selected: only the live per-service catalog carries
    // verified certification data, so that's the only source used — trending,
    // watchlist, and the curated catalog sit out this spin rather than risk an
    // unverified rating slipping through.
    if (ratingFiltered) {
      const liveOnly = svcs
        .filter(s => TMDB_PROVIDERS[s])
        .flatMap(s => liveCatalog[`${s}::${contentRating}`] || [])
        .filter(c => !watchedTitles.has(c.n.toLowerCase()) && c.rt <= maxRt && c.y >= minYr && c.y <= maxYr && (mood === "any" || c.mood === mood))
        .filter(c => {
          const lib = state.films.find(f => f.n.toLowerCase() === c.n.toLowerCase());
          return !lib || !openIds.has(lib.id);
        });
      const seenR = new Set();
      return liveOnly.filter(f => {
        const k = f.n.toLowerCase();
        if (seenR.has(k)) return false;
        seenR.add(k);
        return true;
      });
    }

    const wl = state.films.filter(f =>
      f.status === "watchlist" && !openIds.has(f.id) && svcOk(f) && f.rt <= maxRt && f.y >= minYr && f.y <= maxYr && (mood === "any" || f.mood === mood));
    const TRS = liveTrending || TRENDING;
    const tr = TRS
      .map((t, i) => ({ ...t, rank: i + 1 }))
      .filter(t => !watchedTitles.has(t.n.toLowerCase()) && svcOk(t) && t.rt <= maxRt && t.y >= minYr && t.y <= maxYr && (mood === "any" || t.mood === mood))
      .filter(t => {
        const lib = state.films.find(f => f.n.toLowerCase() === t.n.toLowerCase());
        return !lib || !openIds.has(lib.id);
      });
    const liveFilms = svcs.filter(s => TMDB_PROVIDERS[s]).flatMap(s => liveCatalog[`${s}::any`] || []);
    const cat = [...CATALOG, ...liveFilms]
      .filter(c => !watchedTitles.has(c.n.toLowerCase()) && svcOk(c) && c.rt <= maxRt && c.y >= minYr && c.y <= maxYr && (mood === "any" || c.mood === mood))
      .filter(c => {
        const lib = state.films.find(f => f.n.toLowerCase() === c.n.toLowerCase());
        return !lib || !openIds.has(lib.id);
      });
    if (source === "rewatch") {
      return state.films.filter(f =>
        f.status === "watched" && !openIds.has(f.id) && svcOk(f) &&
        f.rt <= maxRt && f.y >= minYr && f.y <= maxYr && (mood === "any" || f.mood === mood));
    }
    if (source === "watchlist") return wl;
    if (source === "trending") return tr;
    const trTitles = new Set(tr.map(t => t.n.toLowerCase()));
    const seen = new Set();
    const merged = [
      ...wl,
      ...tr.filter(t => !libTitles.has(t.n.toLowerCase())),
      ...cat.filter(c => !libTitles.has(c.n.toLowerCase()) && !trTitles.has(c.n.toLowerCase())),
    ];
    return merged.filter(f => {
      const k = f.n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const pool = buildPool();
  const honor = state.spins.committed ? Math.round(100 * state.spins.honored / state.spins.committed) : null;
  const { calibration } = calStats(state);

  // Safety net: if a landed pick's service gets deselected, clear it.
  useEffect(() => {
    if (display && phase === "landed" && !display.__manual && !services.includes(display.svc)) {
      setPhase("idle"); setDisplay(null); setWhy("");
    }
  }, [services.join("|")]);

  const toggleService = (svc) => {
    setState(s => {
      const cur = s.services || [...ALL_SERVICES];
      const next = cur.includes(svc) ? cur.filter(x => x !== svc) : [...cur, svc];
      return { ...s, services: next };
    });
  };

  const weightOf = (f) => {
    if (source === "rewatch") return f.rating != null ? Math.max(5, (f.rating - 3) * 30) : 30;
    if (source === "watchlist") return 1;
    if (source === "trending") return f.heat;
    const moodW = Math.max(10, (profile.moodScore[f.mood] || 6) * 30);
    const dirW = (profile.dirScore[f.d] || 0) >= 8 ? 200 : 0;
    return moodW + dirW + (f.heat ? f.heat * 0.6 : 0);
  };

  const explain = (f) => {
    if (source === "rewatch") return f.rating != null && f.rating >= 8 ? "A favorite of yours — rewatch night" : "Rewatch night — same film, new verdict";
    if (source === "trending") return `#${f.rank} trending this week`;
    if (source === "watchlist") return "Straight off your watchlist";
    if ((profile.dirScore[f.d] || 0) >= 8) return `You've rated ${f.d}'s films highly`;
    if (f.mood === profile.bestMood) return `${MOODS[f.mood]} films are your highest-rated genre`;
    if (f.heat) return `#${f.rank} trending — a step outside your usual lane`;
    if (f.__live) return `Currently streaming on ${f.svc}`;
    return "A deep cut from the REELmunity catalog";
  };

  const spin = () => {
    const p0 = buildPool();
    if (p0.length === 0) return;
    cloud.logEvent("spin", { source });
    if (!state.everSpun) {
      cloud.logEvent("new_user_first_spin", {});
      trackFirstSpinConversion();
      setState(s => ({ ...s, everSpun: true }));
    }
    setPhase("spinning");
    setWhy("");
    let ticks = 0;
    timer.current = setInterval(() => {
      const p = buildPool();
      if (p.length === 0) { clearInterval(timer.current); setPhase("idle"); setDisplay(null); return; }
      setDisplay(p[Math.floor(Math.random() * p.length)]);
      ticks++;
      if (ticks > 16) {
        clearInterval(timer.current);
        const finalPool = buildPool();
        if (finalPool.length === 0) { setPhase("idle"); setDisplay(null); return; }
        const final = weightedPick(finalPool, weightOf);
        setDisplay(final);
        setWhy(explain(final));
        setPhase("landed");
      }
    }, 85);
  };
  useEffect(() => () => clearInterval(timer.current), []);

  const veto = () => {
    setState(s => ({ ...s, vetoesLeft: Math.max(0, (s.vetoesLeft != null ? s.vetoesLeft : 2) - 1) }));
    setPhase("idle"); setDisplay(null); setWhy(""); setSeenMode(false);
  };

  const markSeen = (withRating) => {
    if (!display) return;
    const ratingVal = withRating ? seenRating : null;
    const noteVal = withRating ? seenNote.trim() : "";
    setState(s => {
      let films = s.films, nextId = s.nextId;
      const existing = films.find(f => f.n.toLowerCase() === display.n.toLowerCase());
      if (existing) {
        films = films.map(f => f.id === existing.id
          ? { ...f, status: "watched", rating: ratingVal != null ? ratingVal : f.rating, note: noteVal || f.note }
          : f);
      } else {
        films = [...films, {
          id: nextId, n: display.n, y: display.y, d: display.d, rt: display.rt,
          mood: display.mood, svc: display.svc, status: "watched", elo: 1500, w: 0, l: 0,
          rating: ratingVal, note: noteVal, syn: display.syn || "", poster: display.poster || null,
        }];
        nextId += 1;
      }
      return { ...s, films, nextId };
    });
    if (withRating) {
      postToLobby(display, {
        u: (state.handle || "Anonymous patron").slice(0, 24),
        t: noteVal.slice(0, 500), r: ratingVal, ts: Date.now(),
      }, user);
    }
    setSeenMode(false); setSeenRating(7.5); setSeenNote("");
    setPhase("idle"); setDisplay(null); setWhy("");
  };

  // Commit hands off straight to the pre-watch rating page (NightFlow stage "prerate")
  const [committing, setCommitting] = useState(false);
  const commit = async () => {
    if (!display) return;
    if (!display.__manual && !services.includes(display.svc)) return;
    const vetoesUsed = 2 - (state.vetoesLeft != null ? state.vetoesLeft : 2);
    cloud.logVetoUsage(vetoesUsed); // fire-and-forget, doesn't block the actual commit
    cloud.logEvent("commit", { source });
    let finalDisplay = display;
    // Live discover picks carry placeholder runtime/director — fetch the real thing before locking it in.
    if (display.__live && display.tmdbId) {
      setCommitting(true);
      try {
        const d = await tmdb.filmDetails(display.tmdbId);
        const dir = ((d.credits && d.credits.crew) || []).find(c => c.job === "Director");
        finalDisplay = {
          ...display,
          rt: d.runtime || display.rt,
          d: dir ? dir.name : display.d,
          syn: (d.overview || display.syn || "").slice(0, 200),
        };
      } catch { /* fall back to placeholder details */ }
      setCommitting(false);
    }
    setState(s => {
      let filmId;
      let films = s.films;
      let nextId = s.nextId;
      const existing = s.films.find(f => f.n.toLowerCase() === finalDisplay.n.toLowerCase());
      if (existing) {
        filmId = existing.id;
      } else {
        filmId = nextId;
        films = [...films, {
          id: nextId, n: finalDisplay.n, y: finalDisplay.y, d: finalDisplay.d, rt: finalDisplay.rt,
          mood: finalDisplay.mood, svc: finalDisplay.svc, status: "watchlist", elo: 1500, w: 0, l: 0, rating: null,
          note: "", syn: finalDisplay.syn || "", poster: finalDisplay.poster || null,
        }];
        nextId += 1;
      }
      return {
        ...s, films, nextId,
        spins: { ...s.spins, committed: s.spins.committed + 1 },
        night: { filmId, stage: "prerate" },
        vetoesLeft: 2,
      };
    });
  };

  const locked = phase === "spinning";
  const sources = [
    { k: "taste", t: "Match my taste", d: "Your watchlist, trending, and every film live on your services — weighted by your ratings." },
    { k: "trending", t: "Trending now", d: "This week's hottest films, live from TMDB." },
    { k: "watchlist", t: "My watchlist", d: "Pure chance across your saved films." },
    { k: "rewatch", t: "Rewatch night", d: "Spin the movies you've already seen — old favorites, fresh verdicts." },
  ];

  return (
    <div className="nol-fade" style={{ maxWidth: 680, margin: "0 auto", padding: "18px 16px 8px" }}>
      <SectionHead kicker="The main attraction" title="What are we watching?"
        sub="Choose how it picks, spin once, and the scrolling is over. One veto per night." />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {sources.map(s => (
          <button key={s.k} className={`nol-source${source === s.k ? " on" : ""}`} onClick={() => !locked && setSource(s.k)}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 19, letterSpacing: "0.1em",
              color: source === s.k ? C.amber : C.text, marginBottom: 3,
            }}>{s.t}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{s.d}</div>
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>
          My services — picks only land on what you can stream
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ALL_SERVICES.map(svc => (
            <button key={svc} className={`nol-chip${services.includes(svc) ? " on" : ""}`}
              onClick={() => !locked && toggleService(svc)}>{svc}</button>
          ))}
        </div>
      </div>

      <div className="nol-filter-grid" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 140px", minWidth: 130 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>Genre</div>
          <select className="nol-input" value={mood} onChange={e => setMood(e.target.value)} disabled={locked} style={{ cursor: "pointer" }}
            aria-label="Genre filter">
            <option value="any">All genres</option>
            {Object.entries(MOODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 140px", minWidth: 130 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>
            Max runtime — <span style={{ color: C.text }}>{maxRt} min</span>
          </div>
          <input type="range" className="nol-range" min="85" max="185" step="5" value={maxRt}
            onChange={e => setMaxRt(Number(e.target.value))} disabled={locked} style={{ width: "100%" }}
            aria-label={`Maximum runtime, currently ${maxRt} minutes`} />
        </div>
        <div style={{ flex: "1 1 140px", minWidth: 130 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>
            Years — <span style={{ color: C.text }}>{minYr <= 1920 && maxYr >= 2025 ? "any era" : `${minYr}–${maxYr}`}</span>
          </div>
          <DualRangeSlider min={1920} max={2025} step={5} lo={minYr} hi={maxYr} disabled={locked}
            onChange={([lo, hi]) => { setMinYr(lo); setMaxYr(hi); }} />
        </div>
        <div style={{ flex: "0 1 108px", minWidth: 100 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>Rating</div>
          <select className="nol-input" value={contentRating} onChange={e => setContentRating(e.target.value)} disabled={locked} style={{ cursor: "pointer", padding: "10px 8px" }}
            aria-label="Content rating filter">
            <option value="any">Any</option>
            <option value="G">G</option>
            <option value="PG">PG</option>
            <option value="PG-13">PG-13</option>
            <option value="R">R</option>
            <option value="NC-17">NC-17</option>
          </select>
          {ratingFiltered && (
            <div style={{ fontSize: 10, color: C.faint, marginTop: 4 }}>Live streaming catalog only</div>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.faint, paddingBottom: 10 }}>
          {pool.length} film{pool.length === 1 ? "" : "s"} in the pool
          {Object.values(loadingSvcs).some(Boolean) && <span style={{ color: C.amberSoft }}> · loading more…</span>}
        </div>
      </div>

      <div style={{
        position: "relative", background: C.panel, borderRadius: 12, marginBottom: 18,
        border: `2px solid ${phase === "landed" ? C.amber : C.edge}`,
        boxShadow: phase === "landed" ? `0 0 40px rgba(255,182,39,0.28)` : "0 4px 18px rgba(0,0,0,0.3)",
        padding: "34px 24px 28px", textAlign: "center", minHeight: 150, transition: "all 0.25s ease",
      }}>
        {phase === "landed" && (
          <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }} aria-hidden="true">
            {[...Array(9)].map((_, i) => (
              <span key={i} className="nol-bulb" style={{ animationDelay: `${(i % 3) * 0.3}s` }} />
            ))}
          </div>
        )}
        {display ? (
          <>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(30px, 6vw, 44px)", letterSpacing: "0.04em", lineHeight: 1.05, marginTop: phase === "landed" ? 10 : 0 }}>
              {display.n}
            </div>
            <div style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>
              {display.y} · {display.rt} min · dir. {display.d} · streaming on <span style={{ color: C.text }}>{display.svc}</span>
            </div>
            {phase === "landed" && (() => {
              const cr = communityFor(display.n);
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 12 }}>
                  {why && (
                    <span style={{
                      fontSize: 13, fontWeight: 700, color: "#14120A", background: C.amber,
                      borderRadius: 999, padding: "5px 14px",
                    }}>{why}</span>
                  )}
                  {cr && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                      color: C.amberSoft, border: `1px solid ${C.edge}`, borderRadius: 999, padding: "4px 12px",
                    }}>
                      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: C.amber }}>{Number(cr.avg_rating).toFixed(1)}</span>
                      The Lobby ({cr.rating_count})
                    </span>
                  )}
                  {display.tmdbId && (
                    <button className="nol-theater-opt" style={{ borderRadius: 999, padding: "5px 14px" }}
                      onClick={() => { cloud.logEvent("theater_action", { action: "overview" }); setTheaterFilm(display); setTheaterMode("overview"); }}>
                      Cast & full overview
                    </button>
                  )}
                </div>
              );
            })()}
            {phase === "landed" && (
              <>
                <p style={{
                  color: C.muted, fontSize: 15, fontStyle: "italic", lineHeight: 1.6,
                  maxWidth: 460, margin: "16px auto 0",
                }}>
                  {display.syn || NO_SYN}
                </p>
                {seenMode ? (
                  <div style={{ marginTop: 20, borderTop: `1px solid ${C.edge}`, paddingTop: 18 }}>
                    <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, marginBottom: 10 }}>
                      Already seen it — rate it
                    </div>
                    <RatingSlider value={seenRating} onChange={setSeenRating} color={C.red} />
                    <div style={{ maxWidth: 440, margin: "14px auto 0" }}>
                      <textarea className="nol-input" rows={2} value={seenNote} onChange={e => setSeenNote(e.target.value)}
                        placeholder="Drop a take for the lobby (optional)" style={{ resize: "vertical" }} />
                    </div>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
                      <button className="nol-btn" onClick={() => markSeen(true)}>Save & spin again</button>
                      <button className="nol-ghost" onClick={() => markSeen(false)}>Skip rating — just don't pick it again</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
                      <button className="nol-btn big" onClick={commit} disabled={committing}>{committing ? "One moment…" : "Commit — start movie night"}</button>
                    </div>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
                      {vetoes > 0 && <button className="nol-ghost" onClick={veto}>Veto — {vetoes} left</button>}
                      {source !== "rewatch" && <button className="nol-ghost" onClick={() => setSeenMode(true)}>I've seen this</button>}
                    </div>
                    {vetoes === 0 && (
                      <p style={{ color: C.red, fontSize: 12, marginTop: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        Vetoes burned — this spin is final
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: "0.15em", color: C.faint, paddingTop: 22 }}>
            {pool.length === 0 ? "NO FILMS MATCH — CHECK SERVICES OR FILTERS" : "THE REEL AWAITS"}
          </div>
        )}
      </div>

      {phase !== "landed" && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button className="nol-btn big" onClick={spin} disabled={pool.length === 0 || phase === "spinning"}>
            {phase === "spinning" ? "Rolling…" : "Pick my movie"}
          </button>
        </div>
      )}

      <div className="nol-stat-row" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginTop: 26 }}>
        <Stat label="Nights" value={state.spins.committed} />
        <Stat label="Streak" value={`${computeStreak(state.nightLog)}🔥`} accent={C.red} />
        <Stat label="Honor" value={honor == null ? "—" : `${honor}%`} accent={C.amber} />
        <Stat label="Calibration" value={calibration == null ? "—" : `${calibration}%`} accent={C.amber} />
        <Stat label="Taste lane" value={MOODS[profile.bestMood].split(" ")[0]} accent={C.green} />
      </div>

      <div style={{ marginTop: 34, paddingTop: 26, borderTop: `1px solid ${C.edge}` }}>
        <TrendingStrip items={liveTrending || TRENDING} live={!!liveTrending} theaterIds={theaterIds} upcomingIds={upcomingIds}
          onOverview={(t) => { cloud.logEvent("theater_action", { action: "overview" }); setTheaterFilm(t); setTheaterMode("overview"); }}
          onTrailer={(t) => { cloud.logEvent("theater_action", { action: "trailer" }); setTheaterFilm(t); setTheaterMode("trailer"); }}
          onTickets={(t) => { cloud.logEvent("theater_action", { action: "tickets" }); setTheaterFilm(t); setTheaterMode("tickets"); }}
          onReleaseDate={(t) => { cloud.logEvent("theater_action", { action: "release" }); setTheaterFilm(t); setTheaterMode("release"); }}
          onPick={(t, rank) => {
            if (phase === "spinning") return;
            setDisplay({ ...t, __manual: true });
            setWhy(`#${rank} trending this week`);
            setPhase("landed");
          }} />
        {theaterFilm && theaterMode === "overview" && <OverviewModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
        {theaterFilm && theaterMode === "trailer" && <TrailerModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
        {theaterFilm && theaterMode === "tickets" && <TicketsModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
        {theaterFilm && theaterMode === "release" && <ReleaseDateModal film={theaterFilm} onClose={() => setTheaterMode(null)} />}
      </div>
    </div>
  );
}

// ---------------- Track record: before/after calls, on the home page ----------------
