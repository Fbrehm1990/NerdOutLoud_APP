import React, { useState, useEffect } from "react";
import { tmdbToFilm, tmdb } from "../lib/tmdb.js";
import { ALL_SERVICES, C, MOODS } from "../lib/constants.js";
import { SectionHead, Panel } from "./Shared.jsx";
import { Lobby } from "./Lobby.jsx";
import { OverviewModal } from "./TheaterFeatures.jsx";

export function TmdbSearch({ state, setState }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [personMatch, setPersonMatch] = useState(null);
  const [personMovies, setPersonMovies] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(null);
  if (!tmdb.enabled()) return null;

  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true); setMsg(""); setResults(null); setPersonMatch(null); setPersonMovies(null);
    try {
      const [rows, person] = await Promise.all([
        tmdb.search(q.trim()),
        tmdb.searchPerson(q.trim()),
      ]);
      setResults(rows);
      if (!rows.length && !person) setMsg("No matches found.");
      if (person) {
        setPersonMatch(person);
        const movies = await tmdb.personMovieCredits(person.id);
        setPersonMovies(movies);
      }
    } catch { setMsg("Search failed — check your connection and try again."); }
    setBusy(false);
  };

  const add = async (r, status) => {
    const exists = state.films.find(f => f.n.toLowerCase() === (r.title || "").toLowerCase());
    if (exists) { setMsg(`"${r.title}" is already in your library.`); return; }
    setAdding(r.id + status);
    try {
      const d = await tmdb.filmDetails(r.id);
      const f = tmdbToFilm(d);
      setState(s => ({
        ...s,
        nextId: s.nextId + 1,
        films: [...s.films, { id: s.nextId, ...f, status, elo: 1500, w: 0, l: 0, rating: null, note: "" }],
      }));
      setMsg(`Added "${f.n}" (${f.svc === "Other" ? "service unknown" : "on " + f.svc}) to your ${status === "watchlist" ? "watchlist" : "watched vault"}.`);
    } catch { setMsg("Couldn't fetch that film's details. Try again."); }
    setAdding(null);
  };

  const renderRow = (r, i, total) => (
    <div key={r.id} className="nol-row" style={{
      display: "flex", gap: 12, alignItems: "center", padding: "10px 4px", flexWrap: "wrap",
      borderBottom: i < total - 1 ? `1px solid ${C.edge}` : "none",
    }}>
      {r.poster_path
        ? <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" width={34} height={51}
            style={{ borderRadius: 4, flexShrink: 0, objectFit: "cover" }} />
        : <div style={{ width: 34, height: 51, background: C.panelHi, borderRadius: 4, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
        <div style={{ color: C.faint, fontSize: 12 }}>
          {r.release_date ? r.release_date.slice(0, 4) : "—"}{r.character ? ` · as ${r.character}` : ""}
        </div>
      </div>
      <button className="nol-chip" onClick={() => add(r, "watchlist")} disabled={!!adding}>
        {adding === r.id + "watchlist" ? "…" : "+ Watchlist"}
      </button>
      <button className="nol-chip" onClick={() => add(r, "watched")} disabled={!!adding}>
        {adding === r.id + "watched" ? "…" : "+ Watched"}
      </button>
    </div>
  );

  return (
    <Panel title="Search every movie" right="live · powered by TMDB">
      <div style={{ display: "flex", gap: 8 }}>
        <input className="nol-input" placeholder="Search any film, actor, or actress…" value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doSearch(); }} />
        <button className="nol-btn" onClick={doSearch} disabled={busy || !q.trim()} style={{ whiteSpace: "nowrap" }}>
          {busy ? "…" : "Search"}
        </button>
      </div>
      {msg && <p style={{ color: C.amberSoft, fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>{msg}</p>}
      {results && results.length > 0 && results.map((r, i) => renderRow(r, i, results.length))}
      {personMatch && personMovies && personMovies.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: C.amber, margin: "0 0 8px 4px" }}>
            Movies with {personMatch.name}
          </div>
          {personMovies.map((r, i) => renderRow(r, i, personMovies.length))}
        </div>
      )}
    </Panel>
  );
}

export function Library({ state, setState, goToFilm }) {
  const blank = { n: "", y: "", d: "", rt: "", mood: "light", svc: "Netflix", status: "watchlist", syn: "" };
  const [form, setForm] = useState(blank);
  const [tab, setTab] = useState("watchlist");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [overviewFilm, setOverviewFilm] = useState(null);

  const add = () => {
    if (!form.n.trim()) return;
    setState(s => ({
      ...s,
      nextId: s.nextId + 1,
      films: [...s.films, {
        id: s.nextId, n: form.n.trim(), y: Number(form.y) || new Date().getFullYear(),
        d: form.d.trim() || "Unknown", rt: Number(form.rt) || 110, mood: form.mood,
        svc: form.svc, status: form.status, elo: 1500, w: 0, l: 0, rating: null, note: "", syn: form.syn.trim(),
      }],
    }));
    setForm(blank);
    setAddOpen(false);
  };
  const remove = (id) => setState(s => ({
    ...s,
    films: s.films.filter(f => f.id !== id),
    predictions: s.predictions.filter(p => p.filmId !== id),
    night: s.night && s.night.filmId === id ? null : s.night,
  }));
  const setFilmPoster = (filmId, poster) => setState(s => ({
    ...s, films: s.films.map(f => f.id === filmId ? { ...f, poster } : f),
  }));

  const q = query.trim().toLowerCase();
  const list = state.films
    .filter(f => f.status === (tab === "watchlist" ? "watchlist" : "watched"))
    .filter(f => !q || f.n.toLowerCase().includes(q) || f.d.toLowerCase().includes(q))
    .sort((a, b) => tab === "watched" ? (b.rating || 0) - (a.rating || 0) : a.n.localeCompare(b.n));

  const counts = {
    watchlist: state.films.filter(f => f.status === "watchlist").length,
    watched: state.films.filter(f => f.status === "watched").length,
  };

  // Background-fetch posters for whatever's currently listed, one at a time.
  const [posterBusy, setPosterBusy] = useState(false);
  useEffect(() => {
    if (!tmdb.enabled() || posterBusy) return;
    const next = list.find(f => !f.poster);
    if (!next) return;
    setPosterBusy(true);
    tmdb.search(next.n).then(rows => {
      if (rows && rows[0] && rows[0].poster_path) setFilmPoster(next.id, rows[0].poster_path);
    }).catch(() => { /* no poster found */ }).finally(() => setPosterBusy(false));
  }, [list.map(f => f.id + (f.poster ? "1" : "0")).join(","), posterBusy]);

  return (
    <div className="nol-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="The vault" title="Your library"
        sub="Your watchlist and your ranked films, together — tap any one to talk about it in The Lobby." />

      <TmdbSearch state={state} setState={setState} />

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <button className={`nol-seg${tab === "watchlist" ? " on" : ""}`} onClick={() => setTab("watchlist")}>
          Watchlist · {counts.watchlist}
        </button>
        <button className={`nol-seg${tab === "watched" ? " on" : ""}`} onClick={() => setTab("watched")}>
          Watched · {counts.watched}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input className="nol-input" placeholder="Search title or director…" value={query}
          onChange={e => setQuery(e.target.value)} />
        <button className="nol-btn" onClick={() => setAddOpen(o => !o)} style={{ whiteSpace: "nowrap" }}>
          {addOpen ? "Close" : "+ Add"}
        </button>
      </div>

      {addOpen && (
        <div className="nol-fade" style={{
          background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            <input className="nol-input" placeholder="Title" value={form.n} onChange={e => setForm({ ...form, n: e.target.value })} />
            <input className="nol-input" placeholder="Year" value={form.y} onChange={e => setForm({ ...form, y: e.target.value })} />
            <input className="nol-input" placeholder="Director" value={form.d} onChange={e => setForm({ ...form, d: e.target.value })} />
            <input className="nol-input" placeholder="Runtime (min)" value={form.rt} onChange={e => setForm({ ...form, rt: e.target.value })} />
            <select className="nol-input" style={{ cursor: "pointer" }} value={form.mood} onChange={e => setForm({ ...form, mood: e.target.value })}>
              {Object.entries(MOODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="nol-input" style={{ cursor: "pointer" }} value={form.svc} onChange={e => setForm({ ...form, svc: e.target.value })}>
              {ALL_SERVICES.map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="nol-input" style={{ cursor: "pointer" }} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="watchlist">Watchlist</option>
              <option value="watched">Watched</option>
            </select>
            <input className="nol-input" placeholder="Synopsis (optional)" value={form.syn}
              onChange={e => setForm({ ...form, syn: e.target.value })} style={{ gridColumn: "1 / -1" }} />
            <button className="nol-btn" onClick={add} disabled={!form.n.trim()}>Add film</button>
          </div>
        </div>
      )}

      <div style={{ background: C.panel, border: `2px solid ${C.edge}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}>
        {list.length === 0 && (
          <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: 24, margin: 0 }}>
            {q ? "No matches." : tab === "watched" ? "Rate a movie after your next pick and it'll show up here, ranked by your score." : "Nothing here yet."}
          </p>
        )}
        {list.map((f, i) => (
          <div key={f.id} className="nol-row nol-media-row" onClick={() => goToFilm(f.id)} style={{
            padding: "10px 16px", cursor: "pointer",
            borderBottom: i < list.length - 1 ? `1px solid ${C.edge}` : "none",
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
              {tab === "watched" && f.rating != null && (
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
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 19, letterSpacing: "0.05em",
                color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{f.n}</div>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                {f.y} · {f.rt}m · {f.svc}
              </div>
              {f.note && (
                <div style={{ color: C.faint, fontSize: 12, fontStyle: "italic", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  "{f.note}"
                </div>
              )}
            </div>
            <div className="nol-media-badges" style={{ alignItems: "center" }}>
              {f.rating != null && (
                <span style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: C.amber,
                  textShadow: "0 0 10px rgba(255,182,39,0.3)", flexShrink: 0,
                }}>{f.rating.toFixed(1)}</span>
              )}
              <span className="nol-ghost" style={{ flexShrink: 0, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}
                title="Overview & cast"
                onClick={(e) => { e.stopPropagation(); setOverviewFilm(f); }}>ℹ️</span>
              <span className="nol-danger-link" style={{ flexShrink: 0 }}
                onClick={(e) => { e.stopPropagation(); remove(f.id); }}>✕</span>
            </div>
          </div>
        ))}
      </div>
      {overviewFilm && <OverviewModal film={overviewFilm} onClose={() => setOverviewFilm(null)} />}
    </div>
  );
}


// ---------------- Members-only gate ----------------
