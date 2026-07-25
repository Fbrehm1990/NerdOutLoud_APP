import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ---------- Portable storage: uses Claude's window.storage when present,
// ---------- falls back to browser localStorage when deployed to the web.
// ---------- "Shared" keys power the film lobbies: shared across users in
// ---------- Claude artifacts; per-browser on a static deploy (until a backend).
const store = {
  async get(key) {
    if (typeof window !== "undefined" && window.storage && window.storage.get) {
      try { const r = await window.storage.get(key); return r ? r.value : null; } catch { return null; }
    }
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  async set(key, value) {
    if (typeof window !== "undefined" && window.storage && window.storage.set) {
      try { await window.storage.set(key, value); return; } catch { return; }
    }
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  async getShared(key) {
    if (typeof window !== "undefined" && window.storage && window.storage.get) {
      try { const r = await window.storage.get(key, true); return r ? r.value : null; } catch { return null; }
    }
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  async setShared(key, value) {
    if (typeof window !== "undefined" && window.storage && window.storage.set) {
      try { await window.storage.set(key, value, true); return; } catch { return; }
    }
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
  },
};

// ---------- Accounts & cloud sync (Supabase) ----------
// To turn accounts ON: create a free project at supabase.com, run the SQL in
// SETUP-ACCOUNTS.md, then paste your project's URL and anon public key below.
// Left blank, the app runs in local mode exactly as before.
const SUPABASE_URL = "https://bymmifuxvrhomqiisntv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qmC0F04efpUP-FuEJ60Qcw_zgf7ITtN"; // publishable key (safe to ship in the page)
// The one account allowed to see the analytics dashboard. Must match the email
// you sign in with AND the email in the SQL policy in SETUP-ACCOUNTS.md — both
// have to agree, or the dashboard stays hidden/blocked. Leave blank to disable it entirely.
const ADMIN_EMAIL = "cyber1patriot@gmail.com";

const cloud = (() => {
  let client = null;
  const ready = () => {
    if (client) return client;
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try { client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); } catch { client = null; }
    }
    return client;
  };
  return {
    enabled: () => !!ready(),
    async getUser() {
      const c = ready(); if (!c) return null;
      try { const { data } = await c.auth.getUser(); return (data && data.user) || null; } catch { return null; }
    },
    onAuthChange(cb) {
      const c = ready(); if (!c) return () => {};
      const { data } = c.auth.onAuthStateChange((event, session) => cb(session ? session.user : null, event));
      return () => { try { data.subscription.unsubscribe(); } catch { /* ignore */ } };
    },
    signUp(email, password) { return ready().auth.signUp({ email, password }); },
    signIn(email, password) { return ready().auth.signInWithPassword({ email, password }); },
    signOut() { return ready().auth.signOut(); },
    // Sends a reset link to the given email. The link brings the user back here
    // with a recovery session — handled by the PASSWORD_RECOVERY event above.
    requestPasswordReset(email) {
      const c = ready(); if (!c) return Promise.resolve({ error: { message: "Not available" } });
      return c.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    },
    updatePassword(newPassword) {
      const c = ready(); if (!c) return Promise.resolve({ error: { message: "Not available" } });
      return c.auth.updateUser({ password: newPassword });
    },
    async loadState(userId) {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_states").select("data").eq("user_id", userId).maybeSingle();
        if (error) return null;
        return data ? data.data : null;
      } catch { return null; }
    },
    async saveState(userId, stateObj) {
      const c = ready(); if (!c) return;
      try { await c.from("nol_states").upsert({ user_id: userId, data: stateObj, updated_at: new Date().toISOString() }); } catch { /* ignore */ }
    },
    async loadLobby(slug) {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_lobby")
          .select("id,parent_id,handle,body,rating,created_at,reactions,spoiler,user_id").eq("film_slug", slug)
          .order("created_at", { ascending: true }).limit(200);
        if (error) return null;
        return data || [];
      } catch { return null; }
    },
    async postLobby(slug, msg, userId) {
      const c = ready(); if (!c) return;
      try {
        await c.from("nol_lobby").insert({
          film_slug: slug, handle: msg.u, body: msg.t, rating: msg.r,
          user_id: userId, parent_id: msg.pid || null, spoiler: !!msg.sp,
        });
      } catch { /* ignore */ }
    },
    async recentLobby() {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_lobby")
          .select("film_slug,handle,body,rating,created_at")
          .order("created_at", { ascending: false }).limit(20);
        if (error) return null;
        return data || [];
      } catch { return null; }
    },
    // Reactions are the one thing anyone signed in can update on someone else's comment —
    // a database trigger (see SETUP-ACCOUNTS.md) blocks any other column from changing this way.
    async react(id, reactions) {
      const c = ready(); if (!c) return false;
      try {
        const { error } = await c.from("nol_lobby").update({ reactions }).eq("id", id);
        return !error;
      } catch { return false; }
    },
    // Editing is owner-only, enforced by both the RLS policy (auth.uid() = user_id
    // required for a row to even be targeted) and the protective trigger.
    async editLobby(id, patch) {
      const c = ready(); if (!c) return false;
      try {
        const { error } = await c.from("nol_lobby").update(patch).eq("id", id);
        return !error;
      } catch { return false; }
    },
    async deleteLobby(id) {
      const c = ready(); if (!c) return false;
      try {
        const { error } = await c.from("nol_lobby").delete().eq("id", id);
        return !error;
      } catch { return false; }
    },
    // Live feed of every new lobby post, used to power in-app notifications while the
    // site is open. Requires Realtime enabled for nol_lobby (see SETUP-ACCOUNTS.md).
    subscribeLobby(onInsert) {
      const c = ready(); if (!c) return () => {};
      try {
        const channel = c.channel("nol_lobby_live")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "nol_lobby" }, (payload) => onInsert(payload.new))
          .subscribe();
        return () => { try { c.removeChannel(channel); } catch { /* ignore */ } };
      } catch { return () => {}; }
    },
    async getCommentOwner(id) {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_lobby").select("user_id").eq("id", id).maybeSingle();
        if (error) return null;
        return data;
      } catch { return null; }
    },
    // Membership: one row per patron, kept in sync with their current patron name.
    // Powers the "Welcome to the family" spotlight and its notification.
    async upsertMember(userId, handle) {
      const c = ready(); if (!c || !handle) return;
      try { await c.from("nol_members").upsert({ user_id: userId, handle }); } catch { /* ignore */ }
    },
    async recentMembers(limit) {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_members")
          .select("user_id,handle,joined_at").order("joined_at", { ascending: false }).limit(limit || 10);
        if (error) return null;
        return data || [];
      } catch { return null; }
    },
    subscribeMembers(onInsert) {
      const c = ready(); if (!c) return () => {};
      try {
        const channel = c.channel("nol_members_live")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "nol_members" }, (payload) => onInsert(payload.new))
          .subscribe();
        return () => { try { c.removeChannel(channel); } catch { /* ignore */ } };
      } catch { return () => {}; }
    },
    // Patron Chatbox: a general live chat room, not tied to any one film.
    async loadChat(limit) {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_chat")
          .select("id,user_id,handle,body,created_at").order("created_at", { ascending: false }).limit(limit || 50);
        if (error) return null;
        return (data || []).reverse();
      } catch { return null; }
    },
    async postChat(userId, handle, body) {
      const c = ready(); if (!c) return false;
      try { const { error } = await c.from("nol_chat").insert({ user_id: userId, handle, body }); return !error; } catch { return false; }
    },
    async deleteChat(id) {
      const c = ready(); if (!c) return false;
      try { const { error } = await c.from("nol_chat").delete().eq("id", id); return !error; } catch { return false; }
    },
    subscribeChat(onInsert, onDelete) {
      const c = ready(); if (!c) return () => {};
      try {
        const channel = c.channel("nol_chat_live")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "nol_chat" }, (payload) => onInsert(payload.new))
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "nol_chat" }, (payload) => onDelete(payload.old))
          .subscribe();
        return () => { try { c.removeChannel(channel); } catch { /* ignore */ } };
      } catch { return () => {}; }
    },
    // ---- Analytics (see admin panel) ----
    // Anyone's visit gets logged (insert is open to everyone); only your account can read it back.
    async logPageview() {
      const c = ready(); if (!c) return;
      try { await c.from("nol_pageviews").insert({ path: (window.location.pathname || "/").slice(0, 200) }); } catch { /* ignore */ }
    },
    async getPageviewCount() {
      const c = ready(); if (!c) return null;
      try {
        const { count, error } = await c.from("nol_pageviews").select("*", { count: "exact", head: true });
        if (error) return null;
        return count;
      } catch { return null; }
    },
    async getPageviewsSince(days) {
      const c = ready(); if (!c) return null;
      try {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const { count, error } = await c.from("nol_pageviews").select("*", { count: "exact", head: true }).gte("created_at", since);
        if (error) return null;
        return count;
      } catch { return null; }
    },
    async getMemberCount() {
      const c = ready(); if (!c) return null;
      try {
        const { count, error } = await c.from("nol_members").select("*", { count: "exact", head: true });
        if (error) return null;
        return count;
      } catch { return null; }
    },
    // Comments/ratings/reactions are derived from the same public nol_lobby table
    // everyone already reads to use the app — see the honesty note in chat.
    async getLobbyStats() {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_lobby").select("body,rating,reactions").limit(5000);
        if (error) return null;
        let comments = 0, ratings = 0, reactions = 0;
        (data || []).forEach(r => {
          if (r.body && r.body.trim()) comments++;
          if (r.rating != null) ratings++;
          if (r.reactions) Object.values(r.reactions).forEach(n => { reactions += Number(n) || 0; });
        });
        return { comments, ratings, reactions, sampled: (data || []).length >= 5000 };
      } catch { return null; }
    },
    async getChatCount() {
      const c = ready(); if (!c) return null;
      try {
        const { count, error } = await c.from("nol_chat").select("*", { count: "exact", head: true });
        if (error) return null;
        return count;
      } catch { return null; }
    },
    // A shared, lightweight film catalog (name/year/director/poster) keyed by slug —
    // populated automatically whenever anyone rates a film — so the community ranking
    // below can show real titles and art, not just slugs, no matter whose library it is.
    async upsertFilmMeta(slug, meta) {
      const c = ready(); if (!c) return;
      try { await c.from("nol_films").upsert({ slug, ...meta }); } catch { /* ignore */ }
    },
    async loadCommunityRatings(limit) {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_community_ratings")
          .select("slug,name,year,director,poster,avg_rating,rating_count")
          .order("avg_rating", { ascending: false }).limit(limit || 50);
        if (error) return null;
        return data || [];
      } catch { return null; }
    },
  };
})();

// ---------- TMDB: live movie data (search, trending, availability) ----------
// All requests route through /api/tmdb (a Netlify Function) — the API key lives
// only on the server now, never in this bundle. See netlify/functions/tmdb.js.
function tmdbProxy(path, params) {
  const qs = new URLSearchParams(params || {});
  qs.set("path", path);
  return `/api/tmdb?${qs.toString()}`;
}

const TMDB_GENRE_KEY = {
  28: "action", 12: "adventure", 16: "animation", 35: "light", 80: "crime",
  99: "documentary", 18: "drama", 10751: "family", 14: "fantasy", 36: "history",
  27: "horror", 10402: "music", 9648: "mind", 10749: "romance", 878: "scifi",
  53: "tense", 10752: "war", 37: "western",
};
function tmdbMood(genreIds) {
  for (const g of (genreIds || [])) { if (TMDB_GENRE_KEY[g]) return TMDB_GENRE_KEY[g]; }
  return "drama";
}

function tmdbSvc(wp) {
  try {
    const flat = (wp && wp.results && wp.results.US && wp.results.US.flatrate) || [];
    for (const p of flat) {
      const n = (p.provider_name || "").toLowerCase();
      if (n.includes("netflix")) return "Netflix";
      if (n.includes("prime") || n.includes("amazon")) return "Prime";
      if (n === "max" || n.includes("hbo")) return "Max";
      if (n.includes("hulu")) return "Hulu";
      if (n.includes("disney")) return "Disney+";
      if (n.includes("tubi")) return "Tubi";
    }
    return "Other";
  } catch { return "Other"; }
}

function tmdbToFilm(d) {
  const dir = ((d.credits && d.credits.crew) || []).find(c => c.job === "Director");
  return {
    n: d.title || "Untitled",
    y: d.release_date ? Number(d.release_date.slice(0, 4)) : new Date().getFullYear(),
    d: dir ? dir.name : "Unknown",
    rt: d.runtime || 110,
    mood: tmdbMood((d.genres || []).map(g => g.id)),
    svc: tmdbSvc(d["watch/providers"]),
    syn: (d.overview || "").slice(0, 200),
    poster: d.poster_path || null,
  };
}

const TMDB_PROVIDERS = { Netflix: 8, Prime: 9, Max: 1899, Hulu: 15, "Disney+": 337, Tubi: 73 };

const tmdb = {
  enabled: () => true,
  async search(q) {
    const r = await fetch(tmdbProxy("/search/movie", { include_adult: "false", query: q }));
    if (!r.ok) throw new Error("search failed");
    const j = await r.json();
    return (j.results || []).slice(0, 8);
  },
  async filmDetails(id) {
    const r = await fetch(tmdbProxy(`/movie/${id}`, { append_to_response: "credits,watch/providers" }));
    if (!r.ok) throw new Error("details failed");
    return r.json();
  },
  async trending() {
    try {
      const cached = await store.get("nol-tmdb-trending-v2");
      if (cached) {
        const { day, items } = JSON.parse(cached);
        if (day === new Date().toDateString() && items && items.length) return items;
      }
    } catch { /* refetch */ }
    const r = await fetch(tmdbProxy("/trending/movie/week"));
    if (!r.ok) throw new Error("trending failed");
    const j = await r.json();
    const top = (j.results || []).slice(0, 10);
    const items = [];
    await Promise.all(top.map(async (m, i) => {
      try {
        const d = await tmdb.filmDetails(m.id);
        items[i] = { tid: "live" + m.id, heat: 100 - i * 3, poster: m.poster_path || null, ...tmdbToFilm(d) };
      } catch { /* skip this title */ }
    }));
    const clean = items.filter(Boolean);
    if (clean.length) {
      try { await store.set("nol-tmdb-trending-v2", JSON.stringify({ day: new Date().toDateString(), items: clean })); } catch { /* ignore */ }
    }
    return clean;
  },
  // Pulls a large, currently-streaming slice for one service via TMDB's discover
  // endpoint (filtered by watch provider), cached per-service for the day.
  async discoverByService(svcName, certification) {
    const pid = TMDB_PROVIDERS[svcName];
    if (!pid) return [];
    const cert = certification && certification !== "any" ? certification : null;
    const cacheKey = "nol-tmdb-discover-v2-" + svcName + (cert ? "-" + cert : "");
    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        const { day, items } = JSON.parse(cached);
        if (day === new Date().toDateString() && items && items.length) return items;
      }
    } catch { /* refetch */ }
    const MAX_PAGES = 50; // ~1,000 titles ceiling per service — see SETUP-ACCOUNTS.md for why this isn't literally infinite
    const pageUrl = (page) => tmdbProxy("/discover/movie", {
      watch_region: "US", with_watch_providers: String(pid), with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc", include_adult: "false", page: String(page),
      // TMDB filters certification for us server-side — no per-title lookups needed.
      ...(cert ? { certification_country: "US", certification: cert } : {}),
    });
    let all = [];
    let totalPages = 1;
    try {
      const r1 = await fetch(pageUrl(1));
      if (r1.ok) {
        const j1 = await r1.json();
        all = all.concat(j1.results || []);
        totalPages = Math.min(j1.total_pages || 1, MAX_PAGES);
      }
    } catch { /* just page 1 results, if any */ }
    const remaining = [];
    for (let p = 2; p <= totalPages; p++) remaining.push(p);
    const BATCH = 6; // fetch several pages at once so a 1,000-title pull doesn't take forever
    for (let i = 0; i < remaining.length; i += BATCH) {
      const batch = remaining.slice(i, i + BATCH);
      try {
        const results = await Promise.all(
          batch.map(p => fetch(pageUrl(p)).then(r => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] })))
        );
        results.forEach(j => { all = all.concat(j.results || []); });
      } catch { break; }
    }
    const items = all.slice(0, MAX_PAGES * 20).map(m => ({
      n: m.title || "Untitled",
      y: m.release_date ? Number(m.release_date.slice(0, 4)) : new Date().getFullYear(),
      d: "Unknown", rt: 110, mood: tmdbMood(m.genre_ids || []), svc: svcName,
      syn: (m.overview || "").slice(0, 200), poster: m.poster_path || null,
      tmdbId: m.id, __live: true,
    }));
    if (items.length) {
      try { await store.set(cacheKey, JSON.stringify({ day: new Date().toDateString(), items })); } catch { /* ignore */ }
    }
    return items;
  },
};

// ---------- OMDb: Rotten Tomatoes, IMDb, and Metacritic scores ----------
// Cached per title+year for the day, same pattern as everything else here.
const omdb = {
  async getRatings(title, year) {
    const cacheKey = "nol-omdb-" + slugify(title) + "-" + (year || "");
    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        const { day, ratings } = JSON.parse(cached);
        if (day === new Date().toDateString()) return ratings;
      }
    } catch { /* refetch */ }
    let ratings = null;
    try {
      const qs = new URLSearchParams({ t: title });
      if (year) qs.set("y", String(year));
      const r = await fetch(`/api/omdb?${qs.toString()}`);
      if (r.ok) {
        const j = await r.json();
        if (j && j.Response !== "False") {
          const out = {};
          (j.Ratings || []).forEach(rt => {
            if (rt.Source === "Rotten Tomatoes") out.rt = rt.Value; // e.g. "94%"
            if (rt.Source === "Internet Movie Database") out.imdb = rt.Value; // e.g. "8.1/10"
            if (rt.Source === "Metacritic") out.metacritic = rt.Value; // e.g. "78/100"
          });
          ratings = Object.keys(out).length ? out : null;
        }
      }
    } catch { /* leave null, badge just won't show */ }
    try { await store.set(cacheKey, JSON.stringify({ day: new Date().toDateString(), ratings })); } catch { /* ignore */ }
    return ratings;
  },
};

const ALL_SERVICES = ["Netflix", "Prime", "Max", "Hulu", "Disney+", "Tubi", "Other"];

const SEED = {
  films: [
    { id: 1, n: "Whiplash", y: 2014, d: "Damien Chazelle", rt: 106, mood: "tense", svc: "Netflix", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A young drummer at an elite conservatory collides with a ruthless instructor who accepts nothing short of greatness." },
    { id: 2, n: "Parasite", y: 2019, d: "Bong Joon-ho", rt: 132, mood: "tense", svc: "Max", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A struggling family cons its way into a wealthy household — until the arrangement unravels in ways nobody sees coming." },
    { id: 3, n: "Mad Max: Fury Road", y: 2015, d: "George Miller", rt: 120, mood: "tense", svc: "Max", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "In a scorched wasteland, a drifter and a rebel commander flee a tyrant in one long, roaring chase for freedom." },
    { id: 4, n: "The Social Network", y: 2010, d: "David Fincher", rt: 120, mood: "tense", svc: "Prime", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "The founding of Facebook becomes a battlefield of lawsuits, betrayal, and raw ambition." },
    { id: 5, n: "Arrival", y: 2016, d: "Denis Villeneuve", rt: 116, mood: "scifi", svc: "Prime", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A linguist races to decode the language of alien visitors — and what she learns rewrites her whole life." },
    { id: 6, n: "Get Out", y: 2017, d: "Jordan Peele", rt: 104, mood: "horror", svc: "Netflix", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A weekend meeting his girlfriend's family turns into a nightmare hiding beneath polite smiles." },
    { id: 7, n: "La La Land", y: 2016, d: "Damien Chazelle", rt: 128, mood: "light", svc: "Netflix", status: "watched", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "An actress and a jazz pianist chase their dreams — and each other — through a bittersweet, technicolor Los Angeles." },
    { id: 8, n: "The Nice Guys", y: 2016, d: "Shane Black", rt: 116, mood: "light", svc: "Netflix", status: "watchlist", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A hapless PI and a hired enforcer stumble through 1970s LA trying to crack a case neither is remotely qualified for." },
    { id: 9, n: "Coherence", y: 2013, d: "James Ward Byrkit", rt: 89, mood: "scifi", svc: "Tubi", status: "watchlist", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A dinner party goes sideways when a passing comet quietly fractures reality among eight friends." },
    { id: 10, n: "Palm Springs", y: 2020, d: "Max Barbakow", rt: 90, mood: "light", svc: "Hulu", status: "watchlist", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "Two wedding guests get stuck in the same inescapable day and decide to make it everyone else's problem." },
    { id: 11, n: "Sicario", y: 2015, d: "Denis Villeneuve", rt: 121, mood: "tense", svc: "Netflix", status: "watchlist", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "An idealistic FBI agent is pulled into the moral fog of a covert war against a cartel." },
    { id: 12, n: "Everything Everywhere All at Once", y: 2022, d: "Daniels", rt: 139, mood: "scifi", svc: "Prime", status: "watchlist", elo: 1500, w: 0, l: 0, rating: null, note: "", syn: "A laundromat owner discovers she must hop between universes to save every version of her family." },
  ],
  predictions: [],
  faceoffCount: 0,
  spins: { committed: 0, honored: 0 },
  night: null,
  services: [...ALL_SERVICES],
  handle: "",
  vetoesLeft: 2,
  notifSeen: { trending: [], svc: {} },
  nightLog: [],
  nextId: 13,
};

const TRENDING = [
  { tid: "t1", n: "Dune: Part Two", y: 2024, d: "Denis Villeneuve", rt: 166, mood: "scifi", svc: "Max", heat: 98, syn: "Paul Atreides joins the Fremen to wage war on those who destroyed his family, as prophecy tightens around him." },
  { tid: "t2", n: "Oppenheimer", y: 2023, d: "Christopher Nolan", rt: 180, mood: "tense", svc: "Prime", heat: 94, syn: "The father of the atomic bomb wrestles with the physics, the politics, and the fallout of his own creation." },
  { tid: "t3", n: "Poor Things", y: 2023, d: "Yorgos Lanthimos", rt: 141, mood: "mind", svc: "Hulu", heat: 89, syn: "A woman brought back to life sets out to see the world on her own defiantly strange terms." },
  { tid: "t4", n: "Glass Onion", y: 2022, d: "Rian Johnson", rt: 139, mood: "light", svc: "Netflix", heat: 86, syn: "Detective Benoit Blanc crashes a billionaire's island getaway, where a murder-mystery game turns very real." },
  { tid: "t5", n: "Top Gun: Maverick", y: 2022, d: "Joseph Kosinski", rt: 130, mood: "tense", svc: "Prime", heat: 84, syn: "A legendary pilot returns to train a new generation for a mission no one is expected to survive." },
  { tid: "t6", n: "Barbie", y: 2023, d: "Greta Gerwig", rt: 114, mood: "light", svc: "Max", heat: 82, syn: "Barbie leaves her perfect plastic world for the real one, where existence turns out to be a lot more complicated." },
  { tid: "t7", n: "The Menu", y: 2022, d: "Mark Mylod", rt: 107, mood: "tense", svc: "Hulu", heat: 77, syn: "A night at an exclusive island restaurant serves up courses with increasingly sinister intent." },
  { tid: "t8", n: "Past Lives", y: 2023, d: "Celine Song", rt: 105, mood: "light", svc: "Prime", heat: 74, syn: "Two childhood friends reunite decades later to weigh the lives they chose — and the one they didn't." },
  { tid: "t9", n: "The Banshees of Inisherin", y: 2022, d: "Martin McDonagh", rt: 114, mood: "tense", svc: "Max", heat: 71, syn: "On a small Irish island, a man abruptly ends a lifelong friendship, with quietly escalating consequences." },
  { tid: "t10", n: "Nope", y: 2022, d: "Jordan Peele", rt: 130, mood: "horror", svc: "Prime", heat: 68, syn: "Two siblings running a horse ranch try to capture proof of something impossible hanging in the sky." },
];


// Built-in catalog: a curated sample library spanning services and moods.
// Availability is sample data — a production build would pull live listings from TMDB/JustWatch.
const CATALOG = [
  // A good time
  { n: "Superbad", y: 2007, d: "Greg Mottola", rt: 113, mood: "light", svc: "Netflix", syn: "Two friends chase one legendary party before high school ends." },
  { n: "The Grand Budapest Hotel", y: 2014, d: "Wes Anderson", rt: 99, mood: "light", svc: "Disney+", syn: "A legendary concierge and his lobby boy tumble through a pastel caper." },
  { n: "Groundhog Day", y: 1993, d: "Harold Ramis", rt: 101, mood: "light", svc: "Netflix", syn: "A cynical weatherman relives the same small-town day until he gets it right." },
  { n: "Ferris Bueller's Day Off", y: 1986, d: "John Hughes", rt: 103, mood: "light", svc: "Prime", syn: "One glorious day of hooky, one furious principal, one borrowed Ferrari." },
  { n: "Anchorman", y: 2004, d: "Adam McKay", rt: 94, mood: "light", svc: "Prime", syn: "A 70s newsman's world crumbles when a talented woman joins the desk." },
  { n: "Step Brothers", y: 2008, d: "Adam McKay", rt: 98, mood: "light", svc: "Max", syn: "Two middle-aged man-children become reluctant, then inseparable, brothers." },
  { n: "Bridesmaids", y: 2011, d: "Paul Feig", rt: 125, mood: "light", svc: "Hulu", syn: "A maid of honor's life unravels spectacularly on the road to the wedding." },
  { n: "Napoleon Dynamite", y: 2004, d: "Jared Hess", rt: 96, mood: "light", svc: "Hulu", syn: "An Idaho misfit helps his friend win class president, one dance at a time." },
  { n: "The Big Lebowski", y: 1998, d: "Joel Coen", rt: 117, mood: "light", svc: "Prime", syn: "The Dude just wants his rug back. The universe has other plans." },
  { n: "Hot Fuzz", y: 2007, d: "Edgar Wright", rt: 121, mood: "light", svc: "Netflix", syn: "A supercop is exiled to a sleepy village hiding a very tidy dark side." },
  { n: "21 Jump Street", y: 2012, d: "Lord & Miller", rt: 109, mood: "light", svc: "Max", syn: "Two hopeless cops go undercover in high school and swap social destinies." },
  { n: "Game Night", y: 2018, d: "Daley & Goldstein", rt: 100, mood: "light", svc: "Max", syn: "A competitive couple's game night collides with an actual kidnapping." },
  { n: "Crazy Rich Asians", y: 2018, d: "Jon M. Chu", rt: 120, mood: "light", svc: "Max", syn: "Meeting the boyfriend's family is harder when they're Singapore royalty-rich." },
  { n: "The Truman Show", y: 1998, d: "Peter Weir", rt: 103, mood: "light", svc: "Prime", syn: "A man slowly discovers his whole life is a television broadcast." },
  { n: "School of Rock", y: 2003, d: "Richard Linklater", rt: 110, mood: "light", svc: "Prime", syn: "A broke rocker fakes his way into teaching and forms a fifth-grade band." },
  { n: "Paddington 2", y: 2017, d: "Paul King", rt: 104, mood: "light", svc: "Netflix", syn: "A polite bear goes to prison and makes it a nicer place." },
  { n: "Chef", y: 2014, d: "Jon Favreau", rt: 114, mood: "light", svc: "Tubi", syn: "A burned-out chef rebuilds his life one food-truck sandwich at a time." },
  { n: "Juno", y: 2007, d: "Jason Reitman", rt: 96, mood: "light", svc: "Hulu", syn: "A sharp-tongued teenager navigates an unplanned pregnancy her own way." },
  { n: "Booksmart", y: 2019, d: "Olivia Wilde", rt: 102, mood: "light", svc: "Prime", syn: "Two overachievers cram four years of fun into one chaotic night." },
  { n: "Free Guy", y: 2021, d: "Shawn Levy", rt: 115, mood: "light", svc: "Disney+", syn: "A video game background character wakes up and decides to be the hero." },
  { n: "Little Miss Sunshine", y: 2006, d: "Dayton & Faris", rt: 101, mood: "light", svc: "Hulu", syn: "A gloriously dysfunctional family road-trips to a kids' beauty pageant." },
  { n: "Forrest Gump", y: 1994, d: "Robert Zemeckis", rt: 142, mood: "light", svc: "Prime", syn: "A gentle soul runs, quite literally, through decades of American history." },
  { n: "The Princess Bride", y: 1987, d: "Rob Reiner", rt: 98, mood: "light", svc: "Disney+", syn: "True love, fencing, giants, revenge — as you wish." },
  { n: "Ratatouille", y: 2007, d: "Brad Bird", rt: 111, mood: "light", svc: "Disney+", syn: "A rat with impeccable taste cooks his way through a Paris kitchen." },
  { n: "Up", y: 2009, d: "Pete Docter", rt: 96, mood: "light", svc: "Disney+", syn: "A grieving old man floats his house to South America; a stowaway helps." },
  { n: "Coco", y: 2017, d: "Lee Unkrich", rt: 105, mood: "light", svc: "Disney+", syn: "A boy crosses into the Land of the Dead to unlock his family's music." },
  { n: "Shrek", y: 2001, d: "Adamson & Jenson", rt: 90, mood: "light", svc: "Netflix", syn: "An ogre rescues a princess and accidentally learns to like people." },
  { n: "Elf", y: 2003, d: "Jon Favreau", rt: 97, mood: "light", svc: "Max", syn: "A human raised by elves takes Christmas cheer to Manhattan, loudly." },
  { n: "Home Alone", y: 1990, d: "Chris Columbus", rt: 103, mood: "light", svc: "Disney+", syn: "An eight-year-old defends his house with hardware-store brutality." },
  // There goes my dinner
  { n: "The Conjuring", y: 2013, d: "James Wan", rt: 112, mood: "horror", svc: "Max", syn: "Paranormal investigators face the darkest case of their careers." },
  { n: "Hereditary", y: 2018, d: "Ari Aster", rt: 127, mood: "horror", svc: "Prime", syn: "A family funeral pulls loose something that should have stayed buried." },
  { n: "A Quiet Place", y: 2018, d: "John Krasinski", rt: 90, mood: "horror", svc: "Prime", syn: "Make a sound, and the things that hunt by hearing will find you." },
  { n: "It", y: 2017, d: "Andy Muschietti", rt: 135, mood: "horror", svc: "Max", syn: "A clown in the sewers feeds on the children of a small town." },
  { n: "The Shining", y: 1980, d: "Stanley Kubrick", rt: 146, mood: "horror", svc: "Max", syn: "A winter caretaker's isolation curdles into murderous madness." },
  { n: "Scream", y: 1996, d: "Wes Craven", rt: 111, mood: "horror", svc: "Prime", syn: "A masked killer terrorizes teens who know the horror-movie rules by heart." },
  { n: "Halloween", y: 1978, d: "John Carpenter", rt: 91, mood: "horror", svc: "Tubi", syn: "The night he came home — and slasher cinema was never the same." },
  { n: "Saw", y: 2004, d: "James Wan", rt: 103, mood: "horror", svc: "Tubi", syn: "Two strangers wake chained in a room with terrible instructions." },
  { n: "Us", y: 2019, d: "Jordan Peele", rt: 116, mood: "horror", svc: "Netflix", syn: "A family's beach vacation is invaded by their own murderous doubles." },
  { n: "Midsommar", y: 2019, d: "Ari Aster", rt: 148, mood: "horror", svc: "Prime", syn: "A grieving woman's trip to a sunny Swedish festival goes very wrong." },
  { n: "The Babadook", y: 2014, d: "Jennifer Kent", rt: 94, mood: "horror", svc: "Tubi", syn: "A storybook monster feeds on a mother's grief and exhaustion." },
  { n: "Insidious", y: 2010, d: "James Wan", rt: 103, mood: "horror", svc: "Netflix", syn: "A comatose boy becomes a doorway for things from The Further." },
  { n: "Evil Dead Rise", y: 2023, d: "Lee Cronin", rt: 96, mood: "horror", svc: "Max", syn: "The Book of the Dead turns a family high-rise into a bloodbath." },
  { n: "Smile", y: 2022, d: "Parker Finn", rt: 115, mood: "horror", svc: "Prime", syn: "A curse passes from victim to witness, always grinning." },
  { n: "Talk to Me", y: 2023, d: "Danny & Michael Philippou", rt: 95, mood: "horror", svc: "Netflix", syn: "Teens use an embalmed hand to touch the dead — as a party game." },
  { n: "The Ring", y: 2002, d: "Gore Verbinski", rt: 115, mood: "horror", svc: "Prime", syn: "Watch the tape, answer the phone, and you have seven days." },
  { n: "Sinister", y: 2012, d: "Scott Derrickson", rt: 110, mood: "horror", svc: "Hulu", syn: "A true-crime writer finds home movies no one should ever watch." },
  { n: "28 Days Later", y: 2002, d: "Danny Boyle", rt: 113, mood: "horror", svc: "Prime", syn: "A man wakes from a coma into a London emptied by rage." },
  { n: "Train to Busan", y: 2016, d: "Yeon Sang-ho", rt: 118, mood: "horror", svc: "Prime", syn: "A father and daughter fight through a zombie outbreak at 300 km/h." },
  { n: "The Witch", y: 2015, d: "Robert Eggers", rt: 92, mood: "horror", svc: "Max", syn: "A Puritan family unravels at the edge of a wood that watches back." },
  // Warp speed
  { n: "Interstellar", y: 2014, d: "Christopher Nolan", rt: 169, mood: "scifi", svc: "Prime", syn: "A pilot leaves a dying Earth to find humanity a new home beyond a wormhole." },
  { n: "The Matrix", y: 1999, d: "The Wachowskis", rt: 136, mood: "scifi", svc: "Max", syn: "A hacker learns reality is a simulation — and he might be the anomaly." },
  { n: "Blade Runner 2049", y: 2017, d: "Denis Villeneuve", rt: 164, mood: "scifi", svc: "Netflix", syn: "A replicant cop uncovers a secret that could unravel society." },
  { n: "Inception", y: 2010, d: "Christopher Nolan", rt: 148, mood: "scifi", svc: "Max", syn: "A thief who steals from dreams takes one last job: planting an idea." },
  { n: "Edge of Tomorrow", y: 2014, d: "Doug Liman", rt: 113, mood: "scifi", svc: "Max", syn: "A soldier relives the same alien battle, dying his way to victory." },
  { n: "The Martian", y: 2015, d: "Ridley Scott", rt: 144, mood: "scifi", svc: "Hulu", syn: "Stranded on Mars, an astronaut sciences the hell out of survival." },
  { n: "Ex Machina", y: 2014, d: "Alex Garland", rt: 108, mood: "scifi", svc: "Prime", syn: "A coder tests a beautiful AI — or is it the other way around?" },
  { n: "District 9", y: 2009, d: "Neill Blomkamp", rt: 112, mood: "scifi", svc: "Netflix", syn: "An alien refugee camp bureaucrat starts becoming what he polices." },
  { n: "Looper", y: 2012, d: "Rian Johnson", rt: 119, mood: "scifi", svc: "Netflix", syn: "A hitman for the mob of the future meets his next target: himself." },
  { n: "Star Wars: A New Hope", y: 1977, d: "George Lucas", rt: 121, mood: "scifi", svc: "Disney+", syn: "A farm boy, a princess, a smuggler, and a battle station's fatal flaw." },
  { n: "Rogue One", y: 2016, d: "Gareth Edwards", rt: 133, mood: "scifi", svc: "Disney+", syn: "The stolen plans that started it all, paid for in full." },
  { n: "Guardians of the Galaxy", y: 2014, d: "James Gunn", rt: 121, mood: "scifi", svc: "Disney+", syn: "A ragtag crew of losers accidentally saves the galaxy, to a killer mixtape." },
  { n: "Back to the Future", y: 1985, d: "Robert Zemeckis", rt: 116, mood: "scifi", svc: "Netflix", syn: "A teen's DeLorean trip to 1955 nearly erases his own existence." },
  { n: "Alien", y: 1979, d: "Ridley Scott", rt: 117, mood: "scifi", svc: "Hulu", syn: "In space, no one can hear you scream." },
  { n: "Aliens", y: 1986, d: "James Cameron", rt: 137, mood: "scifi", svc: "Hulu", syn: "Ripley goes back — this time with marines, and this time it's war." },
  { n: "Minority Report", y: 2002, d: "Steven Spielberg", rt: 145, mood: "scifi", svc: "Prime", syn: "A cop who arrests murderers before they act is accused of a future crime." },
  { n: "Children of Men", y: 2006, d: "Alfonso Cuarón", rt: 109, mood: "scifi", svc: "Prime", syn: "In a world without births, one pregnant woman must be protected." },
  { n: "Snowpiercer", y: 2013, d: "Bong Joon-ho", rt: 126, mood: "scifi", svc: "Netflix", syn: "Humanity's frozen remnant rides one train, and revolt moves car by car." },
  { n: "Prometheus", y: 2012, d: "Ridley Scott", rt: 124, mood: "scifi", svc: "Hulu", syn: "Scientists seek humanity's makers and find something far less friendly." },
  { n: "Avatar", y: 2009, d: "James Cameron", rt: 162, mood: "scifi", svc: "Disney+", syn: "A paralyzed marine's second body pulls him between two worlds at war." },
  // Tense & gripping
  { n: "The Dark Knight", y: 2008, d: "Christopher Nolan", rt: 152, mood: "tense", svc: "Max", syn: "Batman meets an agent of chaos who just wants to watch the world burn." },
  { n: "Se7en", y: 1995, d: "David Fincher", rt: 127, mood: "tense", svc: "Max", syn: "Two detectives hunt a killer preaching through the seven deadly sins." },
  { n: "Gone Girl", y: 2014, d: "David Fincher", rt: 149, mood: "tense", svc: "Netflix", syn: "A wife vanishes and a marriage's picture-perfect surface cracks open." },
  { n: "Zodiac", y: 2007, d: "David Fincher", rt: 157, mood: "tense", svc: "Netflix", syn: "An unsolved killer consumes the men who can't stop chasing him." },
  { n: "Heat", y: 1995, d: "Michael Mann", rt: 170, mood: "tense", svc: "Max", syn: "A master thief and a relentless detective circle one last score." },
  { n: "The Departed", y: 2006, d: "Martin Scorsese", rt: 151, mood: "tense", svc: "Prime", syn: "A cop inside the mob, a mole inside the police, one city between them." },
  { n: "No Country for Old Men", y: 2007, d: "Coen Brothers", rt: 122, mood: "tense", svc: "Prime", syn: "A satchel of drug money draws an implacable killer across Texas." },
  { n: "Prisoners", y: 2013, d: "Denis Villeneuve", rt: 153, mood: "tense", svc: "Netflix", syn: "When his daughter vanishes, a father decides the law is too slow." },
  { n: "Nightcrawler", y: 2014, d: "Dan Gilroy", rt: 117, mood: "tense", svc: "Tubi", syn: "A hungry freelancer films LA's worst nights — then starts arranging them." },
  { n: "Uncut Gems", y: 2019, d: "Safdie Brothers", rt: 135, mood: "tense", svc: "Netflix", syn: "A jeweler with a gambling problem bets everything, constantly, at once." },
  { n: "Wind River", y: 2017, d: "Taylor Sheridan", rt: 107, mood: "tense", svc: "Netflix", syn: "A tracker and a rookie agent hunt a killer across frozen Wyoming." },
  { n: "Hell or High Water", y: 2016, d: "David Mackenzie", rt: 102, mood: "tense", svc: "Prime", syn: "Two brothers rob the very banks foreclosing on their family land." },
  { n: "The Town", y: 2010, d: "Ben Affleck", rt: 125, mood: "tense", svc: "Max", syn: "A Boston bank robber falls for the one witness who could end him." },
  { n: "Argo", y: 2012, d: "Ben Affleck", rt: 120, mood: "tense", svc: "Max", syn: "The CIA fakes a movie to smuggle diplomats out of revolutionary Iran." },
  { n: "Baby Driver", y: 2017, d: "Edgar Wright", rt: 113, mood: "tense", svc: "Netflix", syn: "A getaway driver who runs on music tries to steer out of the life." },
  { n: "John Wick", y: 2014, d: "Chad Stahelski", rt: 101, mood: "tense", svc: "Prime", syn: "They took his car and killed his dog. Big mistake." },
  { n: "Mission: Impossible – Fallout", y: 2018, d: "Christopher McQuarrie", rt: 147, mood: "tense", svc: "Prime", syn: "Ethan Hunt free-falls, cliff-hangs, and helicopter-duels to save millions." },
  { n: "Casino Royale", y: 2006, d: "Martin Campbell", rt: 144, mood: "tense", svc: "Prime", syn: "Bond earns his 00 status across a brutal poker game with global stakes." },
  { n: "The Fugitive", y: 1993, d: "Andrew Davis", rt: 130, mood: "tense", svc: "Max", syn: "A wrongly convicted surgeon runs while hunting his wife's real killer." },
  { n: "Knives Out", y: 2019, d: "Rian Johnson", rt: 130, mood: "tense", svc: "Prime", syn: "A famous detective probes a mystery-writer's very suspicious family." },
  // Mind-bending
  { n: "Memento", y: 2000, d: "Christopher Nolan", rt: 113, mood: "mind", svc: "Tubi", syn: "A man without short-term memory hunts a killer using notes and tattoos." },
  { n: "Eternal Sunshine of the Spotless Mind", y: 2004, d: "Michel Gondry", rt: 108, mood: "mind", svc: "Prime", syn: "Two ex-lovers erase each other — and fight the erasure from inside it." },
  { n: "Shutter Island", y: 2010, d: "Martin Scorsese", rt: 138, mood: "mind", svc: "Netflix", syn: "A marshal investigates an island asylum where nothing adds up." },
  { n: "Donnie Darko", y: 2001, d: "Richard Kelly", rt: 113, mood: "mind", svc: "Tubi", syn: "A giant rabbit tells a troubled teen exactly when the world ends." },
  { n: "The Prestige", y: 2006, d: "Christopher Nolan", rt: 130, mood: "mind", svc: "Max", syn: "Two rival magicians destroy themselves perfecting one impossible trick." },
  { n: "Predestination", y: 2014, d: "Spierig Brothers", rt: 97, mood: "mind", svc: "Prime", syn: "A time agent's final mission folds into itself like a paradox." },
  { n: "Source Code", y: 2011, d: "Duncan Jones", rt: 93, mood: "mind", svc: "Netflix", syn: "A soldier relives eight minutes of a train bombing until he finds the bomber." },
  { n: "Enemy", y: 2013, d: "Denis Villeneuve", rt: 91, mood: "mind", svc: "Tubi", syn: "A professor discovers his exact double, and their lives start to blur." },
  { n: "Primer", y: 2004, d: "Shane Carruth", rt: 77, mood: "mind", svc: "Tubi", syn: "Two engineers build time travel in a garage and immediately regret it." },
  { n: "Annihilation", y: 2018, d: "Alex Garland", rt: 115, mood: "mind", svc: "Netflix", syn: "Scientists enter a shimmer where biology itself rewrites the rules." },
];

const NO_SYN = "No synopsis on file — a mystery even to the archive.";

const C = {
  bg: "#0D0F1E", glow: "#1B2040", panel: "#171B31", panelHi: "#1F2542",
  edge: "#2C3255", edgeHi: "#3D4472", text: "#F0F1FA", muted: "#9CA2C7",
  faint: "#666D99", amber: "#FFB627", amberSoft: "#FFD37A", red: "#E4572E",
  green: "#43C088", paper: "#F3EBDA", paperEdge: "#D8CBAF", ink: "#221E14", inkSoft: "#6B6350",
};

const MOODS = {
  action: "Action", adventure: "Adventure", animation: "Animation", light: "Comedy",
  crime: "Crime", documentary: "Documentary", drama: "Drama", family: "Family",
  fantasy: "Fantasy", history: "History", horror: "Horror", music: "Music",
  mind: "Mystery", romance: "Romance", scifi: "Sci-fi", tense: "Thriller",
  war: "War", western: "Western",
};

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Karla:ital,wght@0,400;0,500;0,700;1,400&family=Courier+Prime:wght@400;700&display=swap');
.nol-root { min-height: 100vh; background: radial-gradient(ellipse 90% 55% at 50% -5%, ${C.glow} 0%, ${C.bg} 62%); font-family: 'Karla', sans-serif; color: ${C.text}; }
.nol-root * { box-sizing: border-box; }
@keyframes nol-chase { 0%, 100% { opacity: 0.25; box-shadow: none; } 50% { opacity: 1; box-shadow: 0 0 10px ${C.amber}, 0 0 20px rgba(255,182,39,0.4); } }
@keyframes nol-stamp { 0% { transform: rotate(-14deg) scale(2.1); opacity: 0; } 60% { transform: rotate(-8deg) scale(0.95); opacity: 1; } 100% { transform: rotate(-8deg) scale(1); opacity: 1; } }
@keyframes nol-rise { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes nol-flicker { 0%, 92%, 100% { opacity: 1; } 94% { opacity: 0.55; } 96% { opacity: 0.9; } }
@keyframes nol-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
@keyframes nol-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
.nol-bulb { width: 8px; height: 8px; border-radius: 50%; background: ${C.amber}; animation: nol-chase 1.6s infinite; }
.nol-fade { animation: nol-rise 0.35s ease both; }
.nol-btn { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2.5px; background: ${C.amber}; color: #14120A; border: none; border-radius: 6px; padding: 10px 26px 8px; cursor: pointer; transition: all 0.15s ease; }
.nol-btn:hover { background: ${C.amberSoft}; box-shadow: 0 0 16px rgba(255,182,39,0.4); transform: translateY(-1px); }
.nol-btn:active { transform: translateY(0); }
.nol-btn:disabled { background: ${C.panelHi}; color: ${C.faint}; cursor: default; box-shadow: none; transform: none; }
.nol-btn.big { font-size: 24px; padding: 14px 44px 11px; letter-spacing: 4px; box-shadow: 0 0 24px rgba(255,182,39,0.3); }
.nol-ghost { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2.5px; background: transparent; color: ${C.muted}; border: 1px solid ${C.edge}; border-radius: 6px; padding: 10px 26px 8px; cursor: pointer; transition: all 0.15s ease; }
.nol-ghost:hover { border-color: ${C.red}; color: ${C.red}; }
.nol-danger-link { color: ${C.faint}; cursor: pointer; font-size: 13px; transition: color 0.15s; }
.nol-danger-link:hover { color: ${C.red}; }
.nol-ticket { position: relative; flex: 1; min-width: 210px; max-width: 300px; cursor: pointer; background: ${C.paper}; border: none; border-radius: 8px; padding: 0; text-align: center; transition: transform 0.15s ease, box-shadow 0.15s ease; box-shadow: 0 4px 14px rgba(0,0,0,0.45); }
.nol-ticket:hover { transform: translateY(-4px) rotate(-0.5deg); box-shadow: 0 12px 28px rgba(0,0,0,0.6), 0 0 22px rgba(255,182,39,0.18); }
.nol-input { background: ${C.bg}; border: 1px solid ${C.edge}; border-radius: 6px; color: ${C.text}; padding: 10px 12px; font-size: 14px; font-family: 'Karla', sans-serif; width: 100%; transition: border-color 0.15s; }
.nol-input:focus { outline: none; border-color: ${C.amber}; }
.nol-row { transition: background 0.15s; }
.nol-row:hover { background: ${C.panelHi}; }
.nol-source { flex: 1; min-width: 140px; cursor: pointer; text-align: left; background: ${C.panel}; border: 1px solid ${C.edge}; border-radius: 10px; padding: 12px 14px; transition: all 0.15s ease; font-family: 'Karla', sans-serif; }
.nol-source:hover { border-color: ${C.edgeHi}; transform: translateY(-2px); }
.nol-source.on { border-color: ${C.amber}; background: ${C.panelHi}; box-shadow: 0 0 20px rgba(255,182,39,0.18); }
.nol-chip { font-family: 'Karla', sans-serif; font-size: 13px; font-weight: 700; padding: 6px 14px; border-radius: 999px; border: 1px solid ${C.edge}; background: transparent; color: ${C.muted}; cursor: pointer; transition: all 0.15s ease; }
.nol-chip:hover { border-color: ${C.edgeHi}; color: ${C.text}; }
.nol-chip.on { background: ${C.amber}; border-color: ${C.amber}; color: #14120A; }
.nol-seg { font-family: 'Bebas Neue', sans-serif; font-size: 17px; letter-spacing: 2px; padding: 8px 22px 6px; cursor: pointer; border: 1px solid ${C.edge}; background: transparent; color: ${C.muted}; transition: all 0.15s ease; }
.nol-seg:first-child { border-radius: 8px 0 0 8px; }
.nol-seg:last-child { border-radius: 0 8px 8px 0; border-left: none; }
.nol-seg.on { background: ${C.amber}; border-color: ${C.amber}; color: #14120A; }
.nol-burger { background: transparent; border: 1px solid ${C.edge}; border-radius: 8px; width: 44px; height: 40px; cursor: pointer; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 5px; transition: border-color 0.15s; }
.nol-burger:hover { border-color: ${C.amber}; }
.nol-burger span { display: block; width: 20px; height: 2px; background: ${C.text}; border-radius: 2px; }
.nol-bell { position: relative; background: transparent; border: 1px solid ${C.edge}; border-radius: 8px; width: 40px; height: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color 0.15s, background 0.15s; flex-shrink: 0; }
.nol-bell:hover { border-color: ${C.amber}; background: rgba(255,182,39,0.06); }
.nol-bell.has-unread { border-color: rgba(255,182,39,0.4); }
.nol-bell-badge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; border-radius: 999px; background: ${C.red}; border: 2px solid ${C.bg}; display: flex; align-items: center; justify-content: center; padding: 0 3px; font-family: 'Bebas Neue', sans-serif; font-size: 10px; letter-spacing: 0.02em; color: ${C.paper}; line-height: 1; }
.nol-menu-item { display: block; width: 100%; text-align: left; background: transparent; border: none; border-bottom: 1px solid ${C.edge}; padding: 18px 24px; cursor: pointer; transition: background 0.15s; font-family: 'Karla', sans-serif; }
.nol-menu-item:hover { background: ${C.panelHi}; }
.nol-popcorn-wrap { flex-shrink: 0; display: flex; align-items: flex-end; }
@media (max-width: 720px) { .nol-popcorn-wrap { transform: scale(0.52); transform-origin: bottom center; margin: 0 -34px; } }
input[type=range].nol-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: ${C.edge}; cursor: pointer; }
input[type=range].nol-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; box-shadow: 0 0 8px rgba(255,182,39,0.5); }
input[type=range].nol-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; }
.nol-dual-range { position: relative; height: 22px; display: flex; align-items: center; }
.nol-dual-range .track-bg { position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: ${C.edge}; }
.nol-dual-range .track-fill { position: absolute; height: 4px; border-radius: 2px; background: ${C.amber}; }
.nol-dual-range input[type=range] { position: absolute; left: 0; right: 0; width: 100%; margin: 0; background: transparent; pointer-events: none; -webkit-appearance: none; appearance: none; height: 22px; touch-action: none; }
.nol-dual-range input[type=range]:active, .nol-dual-range input[type=range]:focus { z-index: 3; }
.nol-dual-range input[type=range]::-webkit-slider-runnable-track { background: transparent; height: 22px; }
.nol-dual-range input[type=range]::-moz-range-track { background: transparent; height: 22px; }
.nol-dual-range input[type=range]::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; box-shadow: 0 0 8px rgba(255,182,39,0.5); cursor: pointer; margin-top: 0; }
.nol-dual-range input[type=range]::-moz-range-thumb { pointer-events: auto; width: 18px; height: 18px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .nol-bulb, .nol-fade { animation: none !important; } .nol-ticket:hover, .nol-btn:hover, .nol-source:hover { transform: none; } }
.nol-btn, .nol-ghost, .nol-chip, .nol-seg, .nol-source, .nol-ticket, .nol-burger, .nol-menu-item { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
@media (pointer: coarse) {
  input[type=range].nol-range { height: 6px; }
  input[type=range].nol-range::-webkit-slider-thumb { width: 26px; height: 26px; }
  input[type=range].nol-range::-moz-range-thumb { width: 26px; height: 26px; }
  .nol-dual-range input[type=range]::-webkit-slider-thumb { width: 26px; height: 26px; }
  .nol-dual-range input[type=range]::-moz-range-thumb { width: 26px; height: 26px; }
  .nol-chip { padding: 9px 16px; }
  .nol-danger-link { padding: 6px 4px; display: inline-block; }
}
@media (max-width: 640px) {
  .nol-btn.big { width: 100%; font-size: 21px; letter-spacing: 3px; padding: 14px 20px 11px; }
  .nol-source { min-width: 100%; }
  .nol-vs-row { flex-direction: column; }
  .nol-ticket { width: 100%; max-width: 100%; min-width: 0; }
  .nol-input, select.nol-input, textarea.nol-input { font-size: 16px; }
  .nol-stat-row > div { flex: 1 1 30%; min-width: 92px; padding: 10px 8px 8px; }
  .nol-media-badges { flex-basis: 100%; justify-content: flex-start !important; margin: 6px 0 0 66px; }
  .nol-filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .nol-filter-grid > div { min-width: 0 !important; flex: none !important; }
  .nol-filter-grid > div:last-child { grid-column: span 1; }
  .nol-howitworks { grid-template-columns: 1fr !important; }
}
@media (max-width: 480px) {
  .nol-live-label { display: none; }
}
@media (max-width: 380px) {
  .nol-media-row { padding-left: 12px !important; padding-right: 12px !important; }
  h1 { font-size: 26px !important; }
}
.nol-media-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.nol-media-badges { display: flex; gap: 8px; flex-shrink: 0; }
.nol-howitworks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.nol-trend-row { display: flex; gap: 12px; overflow-x: auto; padding: 4px 2px 10px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: ${C.edge} transparent; }
.nol-trend-card { position: relative; flex: 0 0 108px; width: 108px; background: transparent; border: none; padding: 0; cursor: pointer; text-align: left; transition: transform 0.15s ease; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.nol-trend-card:hover { transform: translateY(-4px); }
.nol-avatar { flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.5px; color: #14120A; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
.nol-react-pill { font-size: 12px; border: 1px solid ${C.edge}; background: ${C.panel}; border-radius: 999px; padding: 3px 9px 1px; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 4px; }
.nol-react-pill:hover { border-color: ${C.amber}; transform: translateY(-1px); }
.nol-react-pill.mine { background: ${C.panelHi}; border-color: ${C.amber}; color: ${C.amberSoft}; }
.nol-spoiler-wrap { position: relative; cursor: pointer; border-radius: 6px; overflow: hidden; }
.nol-spoiler-blur { filter: blur(6px); user-select: none; pointer-events: none; }
.nol-spoiler-tag { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(13,15,30,0.72); font-family: 'Bebas Neue', sans-serif; font-size: 13px; letter-spacing: 0.15em; color: ${C.amberSoft}; text-transform: uppercase; }
.nol-dist-bar { display: flex; align-items: flex-end; gap: 2px; height: 34px; }
.nol-dist-col { flex: 1; background: ${C.edge}; border-radius: 2px 2px 0 0; min-height: 2px; transition: background 0.15s; }
.nol-dist-col.hot { background: ${C.amber}; }
.nol-lobby-header { position: relative; border-radius: 8px 8px 0 0; overflow: hidden; margin: -14px -16px 12px; height: 86px; }
.nol-lobby-header img { width: 100%; height: 100%; object-fit: cover; object-position: center 20%; display: block; }
.nol-lobby-header::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,15,30,0.15) 0%, ${C.bg} 96%); }
.nol-pin { border: 1px solid ${C.amber}; background: rgba(255,182,39,0.07); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.nol-welcome-row { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: ${C.edge} transparent; }
.nol-welcome-card { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; background: ${C.panel}; border: 1px solid ${C.edge}; border-radius: 999px; padding: 6px 14px 6px 6px; white-space: nowrap; }
.nol-welcome-card.newest { border-color: ${C.amber}; box-shadow: 0 0 14px rgba(255,182,39,0.25); animation: nol-rise 0.4s ease both; }
.nol-chat-msgs { overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
.nol-chat-composer { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid ${C.edge}; background: ${C.panelHi}; }
`;

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function calStats(state) {
  const done = state.predictions.filter(p => p.actual != null);
  const avgGap = done.length ? done.reduce((s, p) => s + Math.abs(p.pred - p.actual), 0) / done.length : null;
  const calibration = avgGap == null ? null : Math.max(0, Math.round(100 - avgGap * 15));
  return { done, avgGap, calibration };
}

// Consecutive calendar days (ending today or yesterday — a night is still "on
// streak" until you've fully skipped a day) with at least one completed night.
function computeStreak(nightLog) {
  const days = new Set(nightLog || []);
  if (days.size === 0) return 0;
  const toISO = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  let cursor = new Date(today);
  if (!days.has(toISO(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // allow "yesterday" to still count as an active streak
    if (!days.has(toISO(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(toISO(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function tasteProfile(films) {
  const rated = films.filter(f => f.status === "watched" && f.rating != null);
  const moodScore = {};
  Object.keys(MOODS).forEach(m => {
    const rows = rated.filter(f => f.mood === m);
    moodScore[m] = rows.length ? rows.reduce((s, f) => s + f.rating, 0) / rows.length : 6;
  });
  const dirScore = {};
  rated.forEach(f => {
    dirScore[f.d] = Math.max(dirScore[f.d] || 0, f.rating);
  });
  const bestMood = Object.entries(moodScore).sort((a, b) => b[1] - a[1])[0][0];
  return { moodScore, dirScore, bestMood };
}

function weightedPick(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

async function postToLobby(film, msg, user) {
  const filmName = film.n;
  if (cloud.enabled()) {
    if (!user) return null;
    try {
      await cloud.postLobby(slugify(filmName), msg, user.id);
      if (msg.r != null) {
        cloud.upsertFilmMeta(slugify(filmName), {
          name: filmName, year: film.y || null, director: film.d || null, poster: film.poster || null,
        });
      }
    } catch { /* ignore */ }
    return null;
  }
  const key = "nol-thread-" + slugify(filmName);
  try {
    const raw = await store.getShared(key);
    let arr = [];
    if (raw) { try { arr = JSON.parse(raw) || []; } catch { arr = []; } }
    if (!msg.id) msg.id = Date.now() + Math.floor(Math.random() * 1000);
    arr.push(msg);
    arr = arr.slice(-200);
    await store.setShared(key, JSON.stringify(arr));
    return arr;
  } catch { return null; }
}

function Popcorn({ flip, size, uid }) {
  const s = size || 96;
  return (
    <svg width={s} height={s * 1.12} viewBox="0 0 96 108" aria-hidden="true"
      style={{ transform: flip ? "scaleX(-1)" : "none", filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.5))" }}>
      <g>
        <circle cx="30" cy="26" r="11" fill="#F3D98C" />
        <circle cx="48" cy="18" r="13" fill="#FFF3D6" />
        <circle cx="66" cy="27" r="11" fill="#F3D98C" />
        <circle cx="38" cy="34" r="10" fill="#FFF3D6" />
        <circle cx="57" cy="33" r="10" fill="#F6E7B8" />
        <circle cx="24" cy="37" r="8" fill="#F6E7B8" />
        <circle cx="72" cy="38" r="8" fill="#FFF3D6" />
        <circle cx="47" cy="27" r="9" fill="#FBE9BF" />
        <circle cx="44" cy="14" r="4" fill="#FFFBEE" />
        <circle cx="62" cy="23" r="3.5" fill="#FFFBEE" />
        <circle cx="33" cy="22" r="3.5" fill="#FFFBEE" />
      </g>
      <rect x="14" y="40" width="68" height="9" rx="4" fill="#E4572E" />
      <rect x="14" y="40" width="68" height="4" rx="2" fill="#F0693F" />
      <clipPath id={`nolBucket-${uid}`}>
        <path d="M18 49 L78 49 L70 104 L26 104 Z" />
      </clipPath>
      <g clipPath={`url(#nolBucket-${uid})`}>
        <rect x="18" y="49" width="60" height="55" fill="#F3EBDA" />
        <rect x="26" y="49" width="10" height="55" fill="#E4572E" />
        <rect x="44" y="49" width="10" height="55" fill="#E4572E" />
        <rect x="62" y="49" width="10" height="55" fill="#E4572E" />
        <rect x="18" y="96" width="60" height="8" fill="rgba(0,0,0,0.14)" />
      </g>
      <circle cx="12" cy="100" r="5" fill="#F3D98C" />
      <circle cx="86" cy="97" r="4" fill="#FFF3D6" />
    </svg>
  );
}

function PopcornPair({ flip, uid }) {
  return (
    <div className="nol-popcorn-wrap" style={{ flexDirection: flip ? "row-reverse" : "row" }}>
      <Popcorn uid={`${uid}-back`} flip={flip} size={66} />
      <div style={{ margin: flip ? "0 -20px 0 0" : "0 0 0 -20px", zIndex: 1 }}>
        <Popcorn uid={`${uid}-front`} flip={flip} size={96} />
      </div>
    </div>
  );
}

function FilmStrip() {
  return (
    <div aria-hidden="true" style={{
      height: 26, display: "flex", alignItems: "center",
      background: "#080A16", borderTop: `1px solid ${C.edge}`, borderBottom: `1px solid ${C.edge}`, overflow: "hidden",
    }}>
      <div style={{ display: "flex", gap: 14, width: "100%", justifyContent: "center" }}>
        {[...Array(40)].map((_, i) => (
          <span key={i} style={{ width: 10, height: 12, borderRadius: 2, background: C.glow, flexShrink: 0 }} />
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["🎬", "Spin", "One tap picks your movie from what's actually on your services."],
    ["⭐", "Rate", "Call your rating before you watch, then settle the real score after."],
    ["💬", "Talk", "Land on Nerdmunity — see what everyone else rated it, and say your piece."],
  ];
  return (
    <div className="nol-howitworks" style={{ maxWidth: 680, margin: "18px auto 0", padding: "0 16px" }}>
      {steps.map(([icon, title, desc], i) => (
        <div key={title} style={{
          background: C.panel, border: `1px solid ${C.edge}`,
          borderRadius: 10, padding: "14px 16px", textAlign: "center",
        }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.1em", color: C.amber }}>
            {i + 1}. {title}
          </div>
          <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.5, margin: "5px 0 0" }}>{desc}</p>
        </div>
      ))}
    </div>
  );
}

function TopBar({ goHome, openMenu, nightActive, unreadCount, onOpenNotifs }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 30, display: "flex", justifyContent: "space-between",
      alignItems: "center", padding: "calc(10px + env(safe-area-inset-top)) 16px 10px",
      background: "rgba(13,15,30,0.88)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.edge}`,
    }}>
      <button onClick={goHome} style={{
        background: "transparent", border: "none", cursor: "pointer",
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: "0.12em", color: C.text, padding: 0,
        display: "flex", alignItems: "center", gap: 8, minWidth: 0,
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          NERD<span style={{ color: C.amber }}>OUT</span>LOUD
        </span>
        {nightActive && (
          <span style={{ color: C.green, fontSize: 14, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
            ●<span className="nol-live-label">movie night live</span>
          </span>
        )}
      </button>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {onOpenNotifs && (
          <button className={`nol-bell${unreadCount > 0 ? " has-unread" : ""}`} onClick={onOpenNotifs} aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M18 8.5c0-3.6-2.7-6.5-6-6.5s-6 2.9-6 6.5c0 5.5-2 7-2 7h16s-2-1.5-2-7z"
                stroke={unreadCount > 0 ? C.amber : C.muted} strokeWidth="1.6" strokeLinejoin="round" fill="none"
              />
              <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" stroke={unreadCount > 0 ? C.amber : C.muted} strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
            {unreadCount > 0 && <span className="nol-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>
        )}
        <button className="nol-burger" onClick={openMenu} aria-label="Open menu">
          <span /><span /><span />
        </button>
      </div>
    </div>
  );
}

function NotifPanel({ open, close, notifications, onClickNotif, onDismiss, onMarkAllRead }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
      <div onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(5,6,14,0.7)" }} />
      <div style={{
        position: "absolute", top: "calc(56px + env(safe-area-inset-top))", right: 16,
        width: "min(360px, 90vw)", maxHeight: "70vh", overflowY: "auto",
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)", animation: "nol-rise 0.18s ease both",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", borderBottom: `1px solid ${C.edge}`, background: C.panelHi,
          position: "sticky", top: 0,
        }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.12em", color: C.amber }}>Notifications</span>
          {notifications.length > 0 && (
            <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={onMarkAllRead}>Clear all</span>
          )}
        </div>
        {notifications.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 13, padding: "20px 18px", margin: 0, textAlign: "center" }}>
            You're all caught up — new comments, replies, and movie drops will show up here.
          </p>
        ) : (
          notifications.map((n, i) => (
            <div key={n.id} className="nol-row" style={{
              display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 18px",
              borderBottom: i < notifications.length - 1 ? `1px solid ${C.edge}` : "none",
              background: "rgba(255,182,39,0.05)",
            }}>
              <div onClick={() => onClickNotif(n)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>{n.title}</span>
                </div>
                {n.sub && <div style={{ color: C.muted, fontSize: 12.5, marginTop: 3, marginLeft: 14, lineHeight: 1.5 }}>{n.sub}</div>}
                <div style={{ color: C.faint, fontSize: 11, marginTop: 4, marginLeft: 14 }}>
                  {new Date(n.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
              <span className="nol-danger-link" style={{ fontSize: 16, flexShrink: 0, padding: "0 2px" }}
                onClick={(e) => { e.stopPropagation(); onDismiss(n); }} aria-label="Dismiss">✕</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Menu({ open, close, go, view, nightActive, state, user }) {
  if (!open) return null;
  const { calibration } = calStats(state);
  const honor = state.spins.committed ? `${Math.round(100 * state.spins.honored / state.spins.committed)}%` : "—";
  const gated = cloud.enabled() && !user;
  const isAdmin = !!(ADMIN_EMAIL && user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  const items = [
    ["home", "Tonight's pick", nightActive ? "Movie night in progress" : "Spin, call it, watch, rate — all in one"],
    ["board", gated ? "Nerdmunity — locked" : "Nerdmunity", gated ? "Create a free account to unlock the community and film lobbies" : "Talk movies with other patrons — rate, review, discuss"],
    ["library", gated ? "Library — locked" : "Library", gated ? "Create a free account to unlock your watchlist, ranking, and movie search" : "Your watchlist and your films, ranked by your rating"],
    ...(user
      ? [["account", "Account", user.email || "Signed in — syncing across devices"]]
      : [
          ["account-signin", "Sign in", "Welcome back — pick up where you left off"],
          ["account-signup", "Create an account", "Sync across devices and post in the lobbies"],
        ]),
    ...(isAdmin ? [["admin", "Analytics", "Visits, accounts, comments, ratings — just for you"]] : []),
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
      <div onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(5,6,14,0.7)" }} />
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "min(320px, 85vw)",
        background: C.panel, borderLeft: `1px solid ${C.edge}`, boxShadow: "-12px 0 40px rgba(0,0,0,0.5)",
        animation: "nol-slide 0.22s ease both", display: "flex", flexDirection: "column",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 24px", borderBottom: `1px solid ${C.edge}`, background: C.panelHi,
        }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.15em", color: C.amber }}>Menu</span>
          <button onClick={close} aria-label="Close menu" style={{
            background: "transparent", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {items.map(([k, t, d]) => (
            <button key={k} className="nol-menu-item" onClick={() => { go(k); close(); }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.1em",
                color: view === k ? C.amber : C.text,
              }}>
                {t}{k === "home" && nightActive && <span style={{ color: C.green, fontSize: 14, marginLeft: 8 }}>●</span>}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{d}</div>
            </button>
          ))}
        </div>
        <div style={{
          padding: "16px 24px", borderTop: `1px solid ${C.edge}`, display: "flex", gap: 20,
          fontFamily: "'Courier Prime', monospace", fontSize: 12, color: C.faint,
        }}>
          <span>Calibration <span style={{ color: C.amber }}>{calibration == null ? "—" : calibration + "%"}</span></span>
          <span>Honor <span style={{ color: C.amber }}>{honor}</span></span>
        </div>
      </div>
    </div>
  );
}

function Marquee() {
  return (
    <header style={{
      display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 18,
      padding: "22px 8px 16px", animation: "nol-flicker 7s infinite", overflow: "hidden",
    }}>
      <PopcornPair uid="left" />
      <div style={{
        display: "inline-block", padding: "14px 24px 16px", borderRadius: 12, width: "min(92vw, 560px)",
        border: `2px solid ${C.edge}`, background: "rgba(23,27,49,0.55)", textAlign: "center",
        boxShadow: "0 0 60px rgba(255,182,39,0.07), inset 0 0 30px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 10 }}>
          {[...Array(11)].map((_, i) => (
            <span key={i} className="nol-bulb" style={{ animationDelay: `${(i % 4) * 0.4}s` }} />
          ))}
        </div>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(28px, 6vw, 46px)",
          letterSpacing: "0.1em", margin: 0, lineHeight: 1, color: C.text,
          textShadow: `0 0 30px rgba(255,182,39,0.25)`,
        }}>
          NERD<span style={{ color: C.amber, textShadow: `0 0 24px rgba(255,182,39,0.6)` }}>OUT</span>LOUD
        </h1>
        <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", textAlign: "center", whiteSpace: "nowrap" }}>
          Stop scrolling · Start watching
        </p>
        <p style={{
          margin: "10px 0 0", color: C.text, fontSize: 15, fontWeight: 700,
          textAlign: "center", maxWidth: 400, marginLeft: "auto", marginRight: "auto", lineHeight: 1.3,
        }}>
          The fastest way to decide what to watch tonight.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 12 }}>
          {[...Array(11)].map((_, i) => (
            <span key={i} className="nol-bulb" style={{ animationDelay: `${((i + 2) % 4) * 0.4}s` }} />
          ))}
        </div>
      </div>
      <PopcornPair uid="right" flip />
    </header>
  );
}

function SectionHead({ kicker, title, sub }) {
  return (
    <div style={{ textAlign: "center", margin: "26px 0 24px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.35em", textTransform: "uppercase", color: C.amber, marginBottom: 6 }}>— {kicker} —</div>
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(30px, 8vw, 38px)", letterSpacing: "0.08em", margin: 0, color: C.text }}>{title}</h2>
      {sub && <p style={{ color: C.muted, fontSize: 14, maxWidth: 480, margin: "10px auto 0", lineHeight: 1.55 }}>{sub}</p>}
    </div>
  );
}

function Panel({ title, right, children }) {
  return (
    <section style={{
      background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10,
      marginBottom: 18, overflow: "hidden", boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        padding: "12px 20px", borderBottom: `1px solid ${C.edge}`, background: C.panelHi,
      }}>
        <span style={{ fontSize: 12, letterSpacing: "0.25em", textTransform: "uppercase", color: C.amber }}>{title}</span>
        {right && <span style={{ fontSize: 12, color: C.faint }}>{right}</span>}
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </section>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 8,
      padding: "12px 22px 10px", textAlign: "center", minWidth: 110, boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, color: accent || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: C.faint, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function RatingSlider({ value, onChange, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
      <input type="range" className="nol-range" min="1" max="10" step="0.5" value={value}
        onChange={e => onChange(Number(e.target.value))} style={{ flex: "1 1 160px", maxWidth: 260 }} />
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, color: color || C.amber, width: 48 }}>{value.toFixed(1)}</span>
    </div>
  );
}

// Two real, independently-draggable thumbs on one track — the standard technique
// of two overlapping native range inputs with pointer-events limited to each thumb.
function DualRangeSlider({ min, max, step, lo, hi, onChange, disabled }) {
  const pct = (v) => ((v - min) / (max - min)) * 100;
  const setLo = (v) => onChange([Math.min(Number(v), hi), hi]);
  const setHi = (v) => onChange([lo, Math.max(Number(v), lo)]);
  return (
    <div className="nol-dual-range">
      <div className="track-bg" />
      <div className="track-fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
      <input type="range" min={min} max={max} step={step} value={lo} disabled={disabled}
        onChange={e => setLo(e.target.value)} aria-label="Minimum" />
      <input type="range" min={min} max={max} step={step} value={hi} disabled={disabled}
        onChange={e => setHi(e.target.value)} aria-label="Maximum" />
    </div>
  );
}

function TicketStub({ film, onPick, corner, tag }) {
  const notch = {
    position: "absolute", width: 20, height: 20, borderRadius: "50%",
    background: C.bg, top: "50%", transform: "translateY(-50%)", zIndex: 2,
  };
  return (
    <button className="nol-ticket" onClick={onPick} aria-label={`Pick ${film.n}`}>
      <span style={{ ...notch, left: -10 }} />
      <span style={{ ...notch, right: -10 }} />
      <div style={{ padding: "12px 22px 0", display: "flex", justifyContent: "flex-end" }}>
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 2, color: C.paper,
          background: corner === 0 ? C.red : C.ink, borderRadius: 3, padding: "3px 10px 1px",
        }}>{tag || "Admit one"}</span>
      </div>
      <div style={{ margin: "8px 18px 14px", borderTop: `2px dashed ${C.paperEdge}`, borderBottom: `2px dashed ${C.paperEdge}`, padding: "16px 6px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 1, lineHeight: 1.02, color: C.ink }}>{film.n}</div>
        <div style={{ color: C.inkSoft, fontSize: 13, marginTop: 8, fontStyle: "italic" }}>{film.y} · dir. {film.d}</div>
        <div style={{ fontFamily: "'Courier Prime', monospace", fontSize: 11, color: C.inkSoft, marginTop: 8, letterSpacing: 1 }}>
          ELO {Math.round(film.elo)} · {film.w}W/{film.l}L
        </div>
      </div>
    </button>
  );
}

// ---------------- Patron avatar: deterministic color from name ----------------
function Avatar({ name, size }) {
  const s = size || 28;
  const str = (name || "?").trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const initials = str.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span className="nol-avatar" style={{ width: s, height: s, fontSize: s * 0.4, background: `hsl(${hue}, 62%, 54%)` }}>
      {initials}
    </span>
  );
}

const REACTIONS = ["🔥", "😂", "💯", "😢", "🍿"];

// ---------------- Film lobby: talk about the movie ----------------
function Lobby({ film, handle, saveHandle, user, goAccount, setFilmPoster, onRate, refreshCommunity }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [cRating, setCRating] = useState("");
  const [spFlag, setSpFlag] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [name, setName] = useState(handle || "");
  const [myReacts, setMyReacts] = useState({});
  const [revealed, setRevealed] = useState({});
  const [mine, setMine] = useState([]);          // ids of comments this browser authored (local mode only)
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editRating, setEditRating] = useState("");
  const [editSp, setEditSp] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const key = "nol-thread-" + slugify(film.n);
  const mineKey = "nol-myreacts-" + slugify(film.n);
  const authoredKey = "nol-authored-" + slugify(film.n);

  const load = async () => {
    if (cloud.enabled()) {
      const rows = await cloud.loadLobby(slugify(film.n));
      if (rows) {
        setMsgs(rows.map(r => ({
          id: r.id, pid: r.parent_id || null, u: r.handle, t: r.body, r: r.rating,
          ts: r.created_at ? Date.parse(r.created_at) : null,
          reactions: r.reactions || {}, sp: !!r.spoiler, uid: r.user_id || null,
        })));
      } else setMsgs([]);
      return;
    }
    try {
      const raw = await store.getShared(key);
      let arr = [];
      if (raw) { try { arr = JSON.parse(raw) || []; } catch { arr = []; } }
      setMsgs(arr.map(m => ({ id: m.id, pid: m.pid || null, u: m.u, t: m.t, r: m.r, ts: m.ts, reactions: m.reactions || {}, sp: !!m.sp })));
    } catch { setMsgs([]); }
  };
  useEffect(() => { load(); }, [film.id]);
  useEffect(() => {
    (async () => {
      try { const raw = await store.get(mineKey); setMyReacts(raw ? JSON.parse(raw) : {}); } catch { setMyReacts({}); }
      if (!cloud.enabled()) {
        try { const raw2 = await store.get(authoredKey); setMine(raw2 ? JSON.parse(raw2) : []); } catch { setMine([]); }
      }
    })();
  }, [film.id]);

  // Fetch a poster once and cache it permanently on the film record.
  useEffect(() => {
    if (film.poster || !tmdb.enabled() || !setFilmPoster) return;
    let on = true;
    tmdb.search(film.n).then(rows => {
      if (on && rows && rows[0] && rows[0].poster_path) setFilmPoster(film.id, rows[0].poster_path);
    }).catch(() => { /* no poster available, header just won't show one */ });
    return () => { on = false; };
  }, [film.id, film.poster]);

  const isMine = (m) => cloud.enabled() ? (!!user && m.uid === user.id) : mine.includes(m.id);

  const post = async () => {
    if (!text.trim() && cRating === "") return;
    const patron = user && handle ? handle : (name.trim() || "Anonymous nerd");
    const m = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      pid: replyTo ? replyTo.id : null,
      u: patron.slice(0, 24),
      t: text.trim().slice(0, 500),
      r: replyTo ? null : (cRating === "" ? null : Number(cRating)),
      sp: spFlag,
      reactions: {},
      ts: Date.now(),
    };
    if (cloud.enabled()) {
      if (!user) return;
      await postToLobby(film, m, user);
      await load();
    } else {
      const arr = await postToLobby(film, m, null);
      if (arr) setMsgs(arr.map(x => ({ id: x.id, pid: x.pid || null, u: x.u, t: x.t, r: x.r, ts: x.ts, reactions: x.reactions || {}, sp: !!x.sp })));
      const nextMine = [...mine, m.id];
      setMine(nextMine);
      store.set(authoredKey, JSON.stringify(nextMine));
    }
    // Rating a film from here is the same as rating it anywhere else — it should
    // show up on "My Ranking" immediately, not just inside the comment itself.
    if (m.r != null && onRate) onRate(film.id, m.r);
    if (m.r != null && refreshCommunity) refreshCommunity();
    setText(""); setCRating(""); setSpFlag(false); setReplyTo(null);
    if (!user && name.trim() && name.trim() !== handle) saveHandle(name.trim());
  };

  const onReact = async (m, emoji) => {
    const myr = myReacts[m.id] || [];
    const already = myr.includes(emoji);
    const nextReactions = { ...(m.reactions || {}) };
    nextReactions[emoji] = Math.max(0, (nextReactions[emoji] || 0) + (already ? -1 : 1));
    setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, reactions: nextReactions } : x));
    const nextMine = { ...myReacts, [m.id]: already ? myr.filter(e => e !== emoji) : [...myr, emoji] };
    setMyReacts(nextMine);
    store.set(mineKey, JSON.stringify(nextMine));
    if (cloud.enabled()) {
      cloud.react(m.id, nextReactions);
    } else {
      try {
        const raw = await store.getShared(key);
        let arr = raw ? JSON.parse(raw) || [] : [];
        arr = arr.map(x => x.id === m.id ? { ...x, reactions: nextReactions } : x);
        await store.setShared(key, JSON.stringify(arr));
      } catch { /* ignore */ }
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id); setEditText(m.t || ""); setEditRating(m.r == null ? "" : String(m.r)); setEditSp(!!m.sp);
    setConfirmDeleteId(null);
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (m) => {
    const patch = {
      t: editText.trim().slice(0, 500),
      r: m.pid ? m.r : (editRating === "" ? null : Number(editRating)),
      sp: editSp,
    };
    setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, t: patch.t, r: patch.r, sp: patch.sp } : x));
    if (cloud.enabled()) {
      await cloud.editLobby(m.id, { body: patch.t, rating: patch.r, spoiler: patch.sp });
    } else {
      try {
        const raw = await store.getShared(key);
        let arr = raw ? JSON.parse(raw) || [] : [];
        arr = arr.map(x => x.id === m.id ? { ...x, t: patch.t, r: patch.r, sp: patch.sp } : x);
        await store.setShared(key, JSON.stringify(arr));
      } catch { /* ignore */ }
    }
    if (!m.pid && patch.r != null && onRate) onRate(film.id, patch.r);
    if (!m.pid && refreshCommunity) refreshCommunity();
    setEditingId(null);
  };

  const doDelete = async (m) => {
    const idsToRemove = new Set([m.id, ...all.filter(x => x.pid === m.id).map(x => x.id)]);
    setMsgs(prev => prev.filter(x => !idsToRemove.has(x.id)));
    setConfirmDeleteId(null);
    if (cloud.enabled()) {
      await cloud.deleteLobby(m.id); // replies cascade server-side
    } else {
      try {
        const raw = await store.getShared(key);
        let arr = raw ? JSON.parse(raw) || [] : [];
        arr = arr.filter(x => !idsToRemove.has(x.id));
        await store.setShared(key, JSON.stringify(arr));
      } catch { /* ignore */ }
      const nextMine = mine.filter(id => !idsToRemove.has(id));
      setMine(nextMine);
      store.set(authoredKey, JSON.stringify(nextMine));
    }
    if (!m.pid && m.r != null && refreshCommunity) refreshCommunity();
  };

  const needSignIn = cloud.enabled() && !user;
  const isAdmin = !!(ADMIN_EMAIL && user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  const all = msgs || [];
  const rated = all.filter(m => m.r != null);
  const avg = rated.length ? rated.reduce((s, m) => s + Number(m.r), 0) / rated.length : null;
  const tops = all.filter(m => !m.pid);
  const kids = (id) => all.filter(m => m.pid === id);
  const reactTotal = (m) => Object.values(m.reactions || {}).reduce((s, n) => s + n, 0);
  const pinned = tops.length > 1 ? tops.reduce((best, m) => reactTotal(m) > reactTotal(best) ? m : best, tops[0]) : null;
  const showPin = pinned && reactTotal(pinned) > 0;

  const dist = Array.from({ length: 10 }, () => 0);
  rated.forEach(m => { const b = Math.min(10, Math.max(1, Math.round(Number(m.r)))); dist[b - 1]++; });
  const distMax = Math.max(1, ...dist);

  const body = (m) => {
    if (!m.t) return null;
    if (m.sp && !revealed[m.id]) {
      return (
        <div className="nol-spoiler-wrap" onClick={() => setRevealed(r => ({ ...r, [m.id]: true }))} style={{ marginTop: 5 }}>
          <div className="nol-spoiler-blur" style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, padding: "6px 0" }}>{m.t}</div>
          <div className="nol-spoiler-tag">Spoiler — tap to reveal</div>
        </div>
      );
    }
    return <div style={{ color: C.muted, fontSize: 14, marginTop: 3, lineHeight: 1.5 }}>{m.t}</div>;
  };

  const row = (m, isReply) => {
    if (editingId === m.id) {
      return (
        <div style={{ display: "flex", gap: 9 }}>
          <Avatar name={m.u} size={isReply ? 24 : 28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.amber, marginBottom: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>Editing</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {!isReply && (
                <button type="button" className={`nol-chip${editRating !== "" ? " on" : ""}`}
                  onClick={() => setEditRating(editRating === "" ? 7.5 : "")}>
                  {editRating === "" ? "Add a rating" : "Remove rating"}
                </button>
              )}
              <button type="button" className={`nol-chip${editSp ? " on" : ""}`} onClick={() => setEditSp(f => !f)}>Spoiler</button>
            </div>
            {!isReply && editRating !== "" && (
              <div style={{ marginTop: 8 }}>
                <RatingSlider value={Number(editRating)} onChange={setEditRating} />
              </div>
            )}
            <textarea className="nol-input" rows={2} value={editText} onChange={e => setEditText(e.target.value)}
              style={{ marginTop: 8, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button className="nol-btn" onClick={() => saveEdit(m)} disabled={!editText.trim() && editRating === ""}>Save</button>
              <button className="nol-ghost" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      );
    }
    const owned = isMine(m);
    const canDelete = owned || isAdmin;
    return (
      <div style={{ display: "flex", gap: 9 }}>
        <Avatar name={m.u} size={isReply ? 24 : 28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{m.u}</span>
            {isAdmin && !owned && (
              <span style={{ fontSize: 9, letterSpacing: "0.1em", color: C.faint, border: `1px solid ${C.edge}`, borderRadius: 4, padding: "1px 5px" }}>MOD VIEW</span>
            )}
            {m.r != null && (
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: "#14120A",
                background: C.amber, borderRadius: 3, padding: "1px 7px 0",
              }}>{Number(m.r).toFixed(1)}</span>
            )}
            <span style={{ fontSize: 11, color: C.faint }}>{m.ts ? new Date(m.ts).toLocaleDateString() : ""}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              {!isReply && !needSignIn && (
                <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={() => setReplyTo(m)}>Reply</span>
              )}
              {owned && confirmDeleteId !== m.id && (
                <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={() => startEdit(m)}>Edit</span>
              )}
              {canDelete && confirmDeleteId !== m.id && (
                <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={() => setConfirmDeleteId(m.id)}>Delete</span>
              )}
              {canDelete && confirmDeleteId === m.id && (
                <>
                  <span style={{ fontSize: 12, color: C.red }} onClick={() => doDelete(m)} className="nol-danger-link">Confirm delete</span>
                  <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={() => setConfirmDeleteId(null)}>Cancel</span>
                </>
              )}
            </div>
          </div>
          {body(m)}
          <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
            {REACTIONS.map(e => {
              const n = (m.reactions || {})[e] || 0;
              const mineReact = (myReacts[m.id] || []).includes(e);
              return (
                <button key={e} className={`nol-react-pill${mineReact ? " mine" : ""}`}
                  onClick={() => !needSignIn && onReact(m, e)} disabled={needSignIn}>
                  <span>{e}</span>{n > 0 && <span>{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="nol-fade" style={{ background: C.bg, border: `1px solid ${C.edge}`, borderRadius: 8, padding: "14px 16px", margin: "4px 0 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", color: C.amber }}>The lobby</span>
        <span style={{ fontSize: 12, color: C.muted }}>
          {avg != null
            ? <>Community score <span style={{ color: C.amber, fontWeight: 700 }}>{avg.toFixed(1)}</span> · {all.length} take{all.length === 1 ? "" : "s"}</>
            : all.length ? `${all.length} take${all.length === 1 ? "" : "s"}` : ""}
        </span>
        <span className="nol-danger-link" style={{ color: C.faint }} onClick={load}>refresh</span>
      </div>

      {rated.length >= 2 && (
        <div style={{ marginBottom: 14 }}>
          <div className="nol-dist-bar">
            {dist.map((n, i) => (
              <div key={i} className={`nol-dist-col${n === distMax ? " hot" : ""}`} style={{ height: `${Math.max(6, (n / distMax) * 34)}px` }} title={`${i + 1}: ${n}`} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.faint, marginTop: 2 }}>
            <span>1</span><span>5</span><span>10</span>
          </div>
        </div>
      )}

      {showPin && (
        <div className="nol-pin">
          <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: C.amber, marginBottom: 6 }}>📌 Top take</div>
          {row(pinned, false)}
        </div>
      )}

      {msgs == null && <p style={{ color: C.faint, fontSize: 13, margin: "0 0 10px" }}>Opening the lobby…</p>}
      {msgs != null && all.length === 0 && (
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 10px" }}>
          No takes yet. Be the first voice in the lobby.
        </p>
      )}
      {tops.map((m, i) => (
        <div key={m.id || m.ts || i} style={{ padding: "10px 0", borderBottom: i < tops.length - 1 ? `1px solid ${C.edge}` : "none" }}>
          {row(m, false)}
          {kids(m.id).map((k, j) => (
            <div key={k.id || k.ts || j} style={{ marginLeft: 20, marginTop: 10, paddingLeft: 12, borderLeft: `2px solid ${C.edgeHi}` }}>
              {row(k, true)}
            </div>
          ))}
        </div>
      ))}
      {needSignIn ? (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button className="nol-btn" onClick={goAccount}>Sign in to join the conversation</button>
        </div>
      ) : (
        <>
          {replyTo && (
            <div style={{ marginTop: 12, fontSize: 12, color: C.muted }}>
              Replying to <span style={{ color: C.amber, fontWeight: 700 }}>{replyTo.u}</span>
              &nbsp;·&nbsp;<span className="nol-danger-link" onClick={() => setReplyTo(null)}>cancel</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: replyTo ? 8 : 12, flexWrap: "wrap", alignItems: "center" }}>
            {user && handle ? (
              <span style={{
                fontSize: 12, fontWeight: 700, color: "#14120A", background: C.amber,
                borderRadius: 999, padding: "6px 14px", whiteSpace: "nowrap",
              }}>{handle}</span>
            ) : (
              <input className="nol-input" placeholder="Your handle" value={name}
                onChange={e => setName(e.target.value)} style={{ flex: "0 1 130px" }} />
            )}
            {!replyTo && (
              <button type="button" className={`nol-chip${cRating !== "" ? " on" : ""}`}
                onClick={() => setCRating(cRating === "" ? 7.5 : "")}>
                {cRating === "" ? "Add a rating" : "Remove rating"}
              </button>
            )}
            <button type="button" className={`nol-chip${spFlag ? " on" : ""}`} onClick={() => setSpFlag(f => !f)}>
              Spoiler
            </button>
          </div>
          {!replyTo && cRating !== "" && (
            <div style={{ marginTop: 8 }}>
              <RatingSlider value={Number(cRating)} onChange={setCRating} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input className="nol-input" placeholder={replyTo ? "Write your reply…" : "Drop your take (optional if you're just rating)…"} value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") post(); }} style={{ flex: "1 1 170px" }} />
            <button className="nol-btn" onClick={post} disabled={!text.trim() && cRating === ""}>{replyTo ? "Reply" : "Post"}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- The guided movie-night flow ----------------
function NightFlow({ state, setState, user, gated, goSignup }) {
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
    postToLobby(film, {
      u: (state.handle || "Anonymous nerd").slice(0, 24),
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
              placeholder="Your take — it gets posted to this film's lobby for other nerds to see (optional)"
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
                That's your rank on the Rating List. Your take also landed in the film's lobby on Nerdmunity.
              </p>
            ) : (
              <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, maxWidth: 400, margin: "0 auto 18px" }}>
                Want to see your Rating List and talk about it with the community? Create a free account
                to unlock your Rating List, Nerdmunity, and sync across your devices.
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
function TrendingStrip({ items, live, onPick }) {
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
        {items.map((t, i) => (
          <button key={t.tid || t.n} className="nol-trend-card" onClick={() => onPick(t, i + 1)} aria-label={`Pick ${t.n}`}>
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
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.n}</div>
            <div style={{ fontSize: 11, color: C.faint }}>{t.y} · {t.svc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Welcome spotlight: newest patrons, live ----------------
function WelcomeSpotlight({ members }) {
  if (!members || !members.length) return null;
  return (
    <div style={{ maxWidth: 680, margin: "0 auto 6px", padding: "0 16px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, marginBottom: 8 }}>
        Welcome to the family
      </div>
      <div className="nol-welcome-row">
        {members.map((m, i) => (
          <div key={m.user_id || i} className={`nol-welcome-card${i === 0 && m.__fresh ? " newest" : ""}`}>
            <Avatar name={m.handle} size={24} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{m.handle}</span>
            {i === 0 && m.__fresh && <span style={{ fontSize: 13 }}>🎬</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Patron Chatbox: general live chat, not tied to any film ----------------
function PatronBoard({ user, handle, goAccount }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!cloud.enabled()) return;
    let on = true;
    cloud.loadChat(50).then(rows => { if (on && rows) setMsgs(rows); }).catch(() => { if (on) setMsgs([]); });
    const off = cloud.subscribeChat(
      (row) => setMsgs(prev => (prev || []).some(m => m.id === row.id) ? prev : [...(prev || []), row]),
      (row) => setMsgs(prev => (prev || []).filter(m => m.id !== row.id))
    );
    return () => { on = false; off(); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  const send = async () => {
    if (!text.trim() || !user) return;
    const patron = (handle || "Anonymous nerd").slice(0, 24);
    const body = text.trim().slice(0, 300);
    setText("");
    await cloud.postChat(user.id, patron, body);
  };

  const remove = async (id) => { await cloud.deleteChat(id); };
  const isAdmin = !!(ADMIN_EMAIL && user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());

  if (!cloud.enabled()) return null;

  return (
    <div style={{ margin: "0 0 26px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.amber, marginBottom: 8 }}>
        Patron Board · live now
      </div>
      <div style={{
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10,
        boxShadow: "0 4px 18px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div className="nol-chat-msgs" ref={scrollRef} style={{ height: 220 }}>
          {msgs == null && <p style={{ color: C.faint, fontSize: 13, textAlign: "center", margin: "10px 0" }}>Opening the lobby…</p>}
          {msgs != null && msgs.length === 0 && (
            <p style={{ color: C.muted, fontSize: 13, textAlign: "center", margin: "10px 0", lineHeight: 1.6 }}>
              Quiet in here. Talk movies — or anything else.
            </p>
          )}
          {(msgs || []).map(m => (
            <div key={m.id} style={{ display: "flex", gap: 8 }}>
              <Avatar name={m.handle} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: C.text }}>{m.handle}</span>
                  <span style={{ fontSize: 10, color: C.faint }}>
                    {m.created_at ? new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}
                  </span>
                  {user && (m.user_id === user.id || isAdmin) && (
                    <span className="nol-danger-link" style={{ fontSize: 10, marginLeft: "auto" }} onClick={() => remove(m.id)}>
                      {m.user_id === user.id ? "delete" : "delete (mod)"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.45, marginTop: 1, wordBreak: "break-word" }}>{m.body}</div>
              </div>
            </div>
          ))}
        </div>

        {user ? (
          <div className="nol-chat-composer">
            <input className="nol-input" placeholder="Talk movies — or anything else…" value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") send(); }} style={{ flex: 1 }} maxLength={300} />
            <button className="nol-btn" onClick={send} disabled={!text.trim()}>Send</button>
          </div>
        ) : (
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.edge}`, background: C.panelHi, textAlign: "center" }}>
            <button className="nol-btn" onClick={goAccount}>Sign in to join the Patron Board</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- The centerpiece picker ----------------
function Picker({ state, setState, user }) {
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
  const timer = useRef(null);

  // Loaded once — lets the landed card show "Nerdmunity rates it 8.2" without
  // any extra clicks or navigation, straight from the same data Nerdmunity uses.
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
    return "A deep cut from the NerdOutLoud catalog";
  };

  const spin = () => {
    const p0 = buildPool();
    if (p0.length === 0) return;
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
        u: (state.handle || "Anonymous nerd").slice(0, 24),
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
      <TrendingStrip items={liveTrending || TRENDING} live={!!liveTrending} onPick={(t, rank) => {
        if (phase === "spinning") return;
        setDisplay({ ...t, __manual: true });
        setWhy(`#${rank} trending this week`);
        setPhase("landed");
      }} />
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
          <select className="nol-input" value={mood} onChange={e => setMood(e.target.value)} disabled={locked} style={{ cursor: "pointer" }}>
            <option value="any">All genres</option>
            {Object.entries(MOODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 140px", minWidth: 130 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>
            Max runtime — <span style={{ color: C.text }}>{maxRt} min</span>
          </div>
          <input type="range" className="nol-range" min="85" max="185" step="5" value={maxRt}
            onChange={e => setMaxRt(Number(e.target.value))} disabled={locked} style={{ width: "100%" }} />
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
          <select className="nol-input" value={contentRating} onChange={e => setContentRating(e.target.value)} disabled={locked} style={{ cursor: "pointer", padding: "10px 8px" }}>
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
                      Nerdmunity ({cr.rating_count})
                    </span>
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
    </div>
  );
}

// ---------------- Track record: before/after calls, on the home page ----------------
function TrackRecord({ state, setState, user }) {
  const { done, avgGap } = calStats(state);
  const nightFilmId = state.night ? state.night.filmId : null;
  const open = state.predictions.filter(p => p.actual == null && p.filmId !== nightFilmId);
  const [rateVal, setRateVal] = useState({});

  const rate = (p) => {
    const val = rateVal[p.filmId] != null ? rateVal[p.filmId] : 7.5;
    const f = state.films.find(x => x.id === p.filmId);
    if (f) {
      postToLobby(f, {
        u: (state.handle || "Anonymous nerd").slice(0, 24), t: "", r: val, ts: Date.now(),
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
function BoardPage({ state, setState, user, goAccount, jumpFilmId, clearJump }) {
  const [expandedId, setExpandedId] = useState(jumpFilmId || null);
  const [pulse, setPulse] = useState(null);
  const [communityRatings, setCommunityRatings] = useState(null);

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
  // so Nerdmunity's ranking reflects everyone, not just what happens to be in your library.
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

  return (
    <div className="nol-fade" style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Now showing" title="Nerdmunity"
        sub="See the User Ranking and your own My Ranking side by side. Tap any film to talk about it — your full ranked list lives in Library." />

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
function TmdbSearch({ state, setState }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(null);
  if (!tmdb.enabled()) return null;

  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true); setMsg(""); setResults(null);
    try {
      const rows = await tmdb.search(q.trim());
      setResults(rows);
      if (!rows.length) setMsg("No matches found.");
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

  return (
    <Panel title="Search every movie" right="live · powered by TMDB">
      <div style={{ display: "flex", gap: 8 }}>
        <input className="nol-input" placeholder="Search any film ever made…" value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doSearch(); }} />
        <button className="nol-btn" onClick={doSearch} disabled={busy || !q.trim()} style={{ whiteSpace: "nowrap" }}>
          {busy ? "…" : "Search"}
        </button>
      </div>
      {msg && <p style={{ color: C.amberSoft, fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>{msg}</p>}
      {results && results.map((r, i) => (
        <div key={r.id} className="nol-row" style={{
          display: "flex", gap: 12, alignItems: "center", padding: "10px 4px", flexWrap: "wrap",
          borderBottom: i < results.length - 1 ? `1px solid ${C.edge}` : "none",
        }}>
          {r.poster_path
            ? <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" width={34} height={51}
                style={{ borderRadius: 4, flexShrink: 0, objectFit: "cover" }} />
            : <div style={{ width: 34, height: 51, background: C.panelHi, borderRadius: 4, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
            <div style={{ color: C.faint, fontSize: 12 }}>{r.release_date ? r.release_date.slice(0, 4) : "—"}</div>
          </div>
          <button className="nol-chip" onClick={() => add(r, "watchlist")} disabled={!!adding}>
            {adding === r.id + "watchlist" ? "…" : "+ Watchlist"}
          </button>
          <button className="nol-chip" onClick={() => add(r, "watched")} disabled={!!adding}>
            {adding === r.id + "watched" ? "…" : "+ Watched"}
          </button>
        </div>
      ))}
    </Panel>
  );
}

function Library({ state, setState, goToFilm }) {
  const blank = { n: "", y: "", d: "", rt: "", mood: "light", svc: "Netflix", status: "watchlist", syn: "" };
  const [form, setForm] = useState(blank);
  const [tab, setTab] = useState("watchlist");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

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
        sub="Your watchlist and your ranked films, together — tap any one to talk about it on Nerdmunity." />

      <TmdbSearch state={state} setState={setState} />

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <button className={`nol-seg${tab === "watchlist" ? " on" : ""}`} onClick={() => setTab("watchlist")}>
          Watchlist · {counts.watchlist}
        </button>
        <button className={`nol-seg${tab === "watched" ? " on" : ""}`} onClick={() => setTab("watched")}>
          Rated · {counts.watched}
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
              <span className="nol-danger-link" style={{ flexShrink: 0 }}
                onClick={(e) => { e.stopPropagation(); remove(f.id); }}>✕</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ---------------- Members-only gate ----------------
function GatePage({ what, onSignup, onSignin }) {
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
          every device — and unlocks Nerdmunity, where you can post your takes for other nerds to see.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="nol-btn big" onClick={onSignup}>Create an account</button>
          <button className="nol-ghost" onClick={onSignin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Admin analytics — visible only to ADMIN_EMAIL ----------------
function AdminPage() {
  const [stats, setStats] = useState(null);
  const [members, setMembers] = useState(null);

  useEffect(() => {
    if (!cloud.enabled()) return;
    let on = true;
    (async () => {
      const [visits, visits7, visits30, accounts, lobby, chats, recent] = await Promise.all([
        cloud.getPageviewCount(),
        cloud.getPageviewsSince(7),
        cloud.getPageviewsSince(30),
        cloud.getMemberCount(),
        cloud.getLobbyStats(),
        cloud.getChatCount(),
        cloud.recentMembers(8),
      ]);
      if (!on) return;
      setStats({ visits, visits7, visits30, accounts, lobby, chats });
      setMembers(recent);
    })();
    return () => { on = false; };
  }, []);

  const v = (x) => x == null ? "—" : x;

  return (
    <div className="nol-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Just for you" title="Analytics"
        sub="A quiet look at how NerdOutLoud is doing. Visible only to your account." />

      {!stats ? (
        <p style={{ color: C.faint, textAlign: "center", padding: 20 }}>Loading…</p>
      ) : (
        <>
          <div className="nol-stat-row" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 22 }}>
            <Stat label="Total visits" value={v(stats.visits)} accent={C.amber} />
            <Stat label="Visits (7d)" value={v(stats.visits7)} />
            <Stat label="Visits (30d)" value={v(stats.visits30)} />
            <Stat label="Accounts" value={v(stats.accounts)} accent={C.green} />
          </div>
          <div className="nol-stat-row" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 26 }}>
            <Stat label="Comments" value={v(stats.lobby && stats.lobby.comments)} />
            <Stat label="Ratings" value={v(stats.lobby && stats.lobby.ratings)} />
            <Stat label="Reactions" value={v(stats.lobby && stats.lobby.reactions)} />
            <Stat label="Chat msgs" value={v(stats.chats)} />
          </div>
          {stats.lobby && stats.lobby.sampled && (
            <p style={{ color: C.faint, fontSize: 11, textAlign: "center", marginTop: -14, marginBottom: 20 }}>
              Comment/rating/reaction counts are from the most recent 5,000 lobby posts.
            </p>
          )}

          {members && members.length > 0 && (
            <Panel title="Newest patrons">
              {members.map((m, i) => (
                <div key={m.user_id || i} style={{
                  display: "flex", justifyContent: "space-between", padding: "7px 0",
                  borderBottom: i < members.length - 1 ? `1px solid ${C.edge}` : "none",
                }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{m.handle}</span>
                  <span style={{ fontSize: 12, color: C.faint }}>
                    {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ""}
                  </span>
                </div>
              ))}
            </Panel>
          )}

          <p style={{ color: C.faint, fontSize: 11, textAlign: "center", lineHeight: 1.6, marginTop: 10 }}>
            Visit counts are restricted to your account at the database level. Comment, rating, reaction,
            and chat counts come from the same tables every patron already reads to use the app.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------- Account page ----------------
function ResetPasswordPage({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (pw.length < 8) { setMsg("Password needs to be at least 8 characters."); return; }
    if (pw !== pw2) { setMsg("Passwords don't match."); return; }
    setBusy(true); setMsg("");
    try {
      const { error } = await cloud.updatePassword(pw);
      if (error) setMsg(error.message);
      else setDone(true);
    } catch { setMsg("Something went wrong. Try again."); }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="nol-fade" style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>
        <SectionHead kicker="Accounts" title="Password updated" sub="You're all set." />
        <div style={{ textAlign: "center" }}>
          <button className="nol-btn big" onClick={onDone}>Continue to NerdOutLoud</button>
        </div>
      </div>
    );
  }

  return (
    <div className="nol-fade" style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Accounts" title="Set a new password" sub="Choose something you haven't used here before." />
      <div style={{
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 20,
        display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
      }}>
        <label htmlFor="nol-newpw" style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: -6 }}>New password</label>
        <input className="nol-input" type="password" id="nol-newpw" name="new-password"
          placeholder="8+ characters" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
        <label htmlFor="nol-newpw2" style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: -6 }}>Confirm new password</label>
        <input className="nol-input" type="password" id="nol-newpw2" name="new-password"
          placeholder="Type it again" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password"
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        {msg && <p style={{ color: C.amberSoft, fontSize: 13, margin: 0, lineHeight: 1.5 }}>{msg}</p>}
        <button className="nol-btn" onClick={submit} disabled={busy || !pw || !pw2}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </div>
    </div>
  );
}

function AccountPage({ user, onDone, initialMode, handle, saveHandle }) {
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "signin");
  const [uname, setUname] = useState("");
  const [patronEdit, setPatronEdit] = useState(handle || "");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Pre-fill a remembered email on this device (if the user opted in previously)
  useEffect(() => {
    (async () => {
      const pref = await store.get("nol-remember-email");
      if (pref === "0") { setRemember(false); return; }
      const saved = await store.get("nol-last-email");
      if (saved) setEmail(saved);
    })();
  }, []);

  const persistEmailChoice = async (em) => {
    await store.set("nol-remember-email", remember ? "1" : "0");
    await store.set("nol-last-email", remember ? em : "");
  };

  if (!cloud.enabled()) {
    return (
      <div className="nol-fade" style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px 40px" }}>
        <SectionHead kicker="Accounts" title="Not switched on yet"
          sub="This copy of NerdOutLoud is running in local mode — everything saves to this browser only." />
        <Panel title="How to turn accounts on">
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
            Accounts, cross-device sync, and shared lobbies activate when the site is connected to a free
            Supabase project. The one-time setup takes about ten minutes: create a project at supabase.com,
            run the provided SQL, and paste the project's URL and anon key into the site's configuration.
            Full instructions ship with the site files as SETUP-ACCOUNTS.md.
          </p>
        </Panel>
      </div>
    );
  }

  if (user) {
    return (
      <div className="nol-fade" style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px 40px" }}>
        <SectionHead kicker="Accounts" title="You're signed in" sub={user.email || ""} />
        <Panel title="Patron name" right="shown on all your reviews & comments">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input className="nol-input" placeholder="Your patron name" value={patronEdit}
              onChange={e => setPatronEdit(e.target.value)} maxLength={24} style={{ flex: "1 1 180px" }} />
            <button className="nol-btn" disabled={!patronEdit.trim() || patronEdit.trim() === handle}
              onClick={() => saveHandle(patronEdit.trim().slice(0, 24))}>
              {handle && patronEdit.trim() === handle ? "Saved" : "Save"}
            </button>
          </div>
          {handle && <p style={{ color: C.faint, fontSize: 12, margin: "10px 0 0" }}>Currently posting as <span style={{ color: C.amber }}>{handle}</span>.</p>}
        </Panel>
        <Panel title="Sync">
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
            Your Rating List, library, ratings, and settings sync to your account automatically and follow you
            to any device you sign in on. Lobby posts are shared with all NerdOutLoud users. You'll stay
            signed in on this device until you sign out.
          </p>
        </Panel>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button className="nol-ghost" onClick={async () => { await cloud.signOut(); onDone(); }}>Sign out</button>
        </div>
      </div>
    );
  }

  const go = async () => {
    if (!email.trim() || !pw) return;
    setBusy(true); setMsg("");
    try {
      const { error } = mode === "signin"
        ? await cloud.signIn(email.trim(), pw)
        : await cloud.signUp(email.trim(), pw);
      if (error) setMsg(error.message);
      else {
        await persistEmailChoice(email.trim());
        if (mode === "signup") {
          if (uname.trim()) saveHandle(uname.trim().slice(0, 24));
          setMsg("Account created. If your email needs confirming, check your inbox — then sign in.");
        }
        else onDone();
      }
    } catch (e) { setMsg("Something went wrong. Try again."); }
    setBusy(false);
  };

  const sendReset = async () => {
    if (!email.trim()) return;
    setBusy(true); setMsg("");
    try {
      const { error } = await cloud.requestPasswordReset(email.trim());
      setMsg(error ? error.message : "Check your inbox — we sent a link to reset your password.");
    } catch { setMsg("Something went wrong. Try again."); }
    setBusy(false);
  };

  if (mode === "forgot") {
    return (
      <div className="nol-fade" style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>
        <SectionHead kicker="Accounts" title="Reset your password"
          sub="Enter your email and we'll send you a link to set a new one." />
        <div style={{
          background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 20,
          display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
        }}>
          <label htmlFor="nol-forgot-email" style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: -6 }}>Email</label>
          <input className="nol-input" type="email" id="nol-forgot-email" name="email" inputMode="email"
            placeholder="you@example.com" value={email}
            onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false}
            onKeyDown={e => { if (e.key === "Enter") sendReset(); }} />
          {msg && <p style={{ color: C.amberSoft, fontSize: 13, margin: 0, lineHeight: 1.5 }}>{msg}</p>}
          <button className="nol-btn" onClick={sendReset} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <span className="nol-danger-link" style={{ textAlign: "center", fontSize: 13 }} onClick={() => { setMode("signin"); setMsg(""); }}>
            Back to sign in
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="nol-fade" style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Accounts" title={mode === "signin" ? "Sign in" : "Create your account"}
        sub="Sync your Rating List across devices and join Nerdmunity." />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
        <button className={`nol-seg${mode === "signin" ? " on" : ""}`} onClick={() => { setMode("signin"); setMsg(""); }}>Sign in</button>
        <button className={`nol-seg${mode === "signup" ? " on" : ""}`} onClick={() => { setMode("signup"); setMsg(""); }}>Create account</button>
      </div>
      <div style={{
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 20,
        display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
      }}>
        {mode === "signup" && (
          <>
            <label htmlFor="nol-username" style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: -6 }}>Patron name</label>
            <input className="nol-input" type="text" id="nol-username" name="username"
              placeholder="Your public username (shown on reviews)" value={uname}
              onChange={e => setUname(e.target.value)} autoComplete="username" maxLength={24} autoCapitalize="none" spellCheck={false} />
          </>
        )}
        <label htmlFor="nol-email" style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: -6 }}>Email</label>
        <input className="nol-input" type="email" id="nol-email" name="email" inputMode="email"
          placeholder="you@example.com" value={email}
          onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} />
        <label htmlFor="nol-password" style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: -6 }}>Password</label>
        <input className="nol-input" type="password" id="nol-password" name="password"
          placeholder="8+ characters" value={pw}
          onChange={e => setPw(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          onKeyDown={e => { if (e.key === "Enter") go(); }} />
        {mode === "signin" && (
          <span className="nol-danger-link" style={{ fontSize: 12, textAlign: "right" }}
            onClick={() => { setMode("forgot"); setMsg(""); }}>Forgot password?</span>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted, cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#FFB627", cursor: "pointer" }} />
          Remember my email on this device
        </label>
        {msg && <p style={{ color: C.amberSoft, fontSize: 13, margin: 0, lineHeight: 1.5 }}>{msg}</p>}
        <button className="nol-btn" onClick={go}
          disabled={busy || !email.trim() || pw.length < 8 || (mode === "signup" && uname.trim().length < 2)}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <p style={{ color: C.faint, fontSize: 12, lineHeight: 1.55, margin: 0, textAlign: "center" }}>
          Your browser or password manager can autofill and save these details. You'll stay signed in until you sign out.
        </p>
      </div>
      <p style={{ color: C.faint, fontSize: 12, lineHeight: 1.6, marginTop: 14, textAlign: "center" }}>
        By creating an account you agree to the Terms of service and Privacy policy linked in the footer.
      </p>
    </div>
  );
}

// ---------------- Legal documents ----------------
const LEGAL_EFFECTIVE = "July 18, 2026";

const LEGAL_TERMS = [
  ["1. Acceptance of these terms", "By using NerdOutLoud (the \"Service\"), you agree to these Terms of Service. If you do not agree, please do not use the Service."],
  ["2. What NerdOutLoud is", "NerdOutLoud is an entertainment tool that helps you choose movies, record personal ratings and predictions, rank films you have watched, and discuss films with other users. Information shown in the Service — including streaming availability, film details, and synopses — is provided for convenience and may be incomplete, outdated, or inaccurate. Always confirm availability with the streaming service itself."],
  ["3. Eligibility", "You must be at least 13 years old to use the Service. If you are under the age of majority where you live, you may use the Service only with the consent of a parent or guardian."],
  ["4. Accounts", "You can use the Service without an account. Creating an account adds cross-device sync and the ability to post in film lobbies. If you create an account, you agree to provide accurate information, keep your login credentials confidential, and accept responsibility for all activity that occurs under your account. Accounts are personal to you and may not be shared or transferred. Notify us promptly at [YOUR CONTACT EMAIL] if you suspect unauthorized use of your account. We may suspend or terminate accounts that violate these Terms. You may request deletion of your account and its data at any time by contacting us."],
  ["5. Your content", "You may post comments, ratings, and a display handle (\"User Content\"). Content posted to film lobbies is public and displayed with your chosen handle. You keep ownership of your User Content. By posting, you grant us a non-exclusive, worldwide, royalty-free license to store and display that content within the Service so the feature can function. You are solely responsible for what you post."],
  ["6. Acceptable use", "You agree not to post content that is unlawful, harassing, hateful, defamatory, obscene, infringing, or that contains personal information about another person without their consent; not to impersonate others or misrepresent your affiliation; and not to interfere with, disrupt, or attempt to gain unauthorized access to the Service or other users' accounts. We may remove content or restrict access at our discretion, without notice."],
  ["7. No affiliation with streaming services", "NerdOutLoud is not affiliated with, endorsed by, or sponsored by Netflix, Amazon Prime Video, Max, Hulu, Disney+, Tubi, or any other streaming service, studio, or rights holder. All trademarks, service marks, and film titles referenced belong to their respective owners and are used only to identify the services and works in question. NerdOutLoud does not host, stream, or distribute any films."],
  ["8. Our intellectual property", "The Service's design, name, graphics, and code are owned by the operator of NerdOutLoud. You may not copy, resell, or redistribute the Service except as permitted by law."],
  ["9. Third-party services", "The Service loads fonts and software libraries from third-party servers, uses a third-party database and authentication provider to power accounts and lobbies, and may link to third-party websites or apps. We are not responsible for third-party content, services, or policies."],
  ["10. Disclaimer of warranties", "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE,\" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT DATA WILL NOT BE LOST."],
  ["11. Limitation of liability", "TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE OPERATOR OF NERDOUTLOUD WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF THE AMOUNT YOU PAID US IN THE PAST TWELVE MONTHS (CURRENTLY ZERO) OR TEN U.S. DOLLARS. Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you."],
  ["12. Indemnification", "You agree to indemnify and hold harmless the operator of NerdOutLoud from claims arising out of your User Content or your violation of these Terms."],
  ["13. Copyright complaints", "If you believe content in the Service infringes your copyright, contact us at [YOUR CONTACT EMAIL] with sufficient detail to identify the material, and we will review and respond appropriately."],
  ["14. Changes and termination", "We may update these Terms or modify or discontinue the Service at any time. Material changes will be reflected by updating the effective date above. Continued use after changes means you accept the updated Terms. You may stop using the Service at any time, and may request deletion of your account as described in Section 4."],
  ["15. Governing law", "These Terms are governed by the laws of [YOUR STATE / COUNTRY], without regard to conflict-of-law rules."],
  ["16. Contact", "Questions about these Terms: [YOUR CONTACT EMAIL]."],
];

const LEGAL_PRIVACY = [
  ["1. Overview", "NerdOutLoud is local-first with optional accounts. You can use the core features with nothing stored outside your own browser; creating an account adds cross-device sync and community lobbies, which requires storing some data on servers as described below. We show no advertising, use no analytics trackers, and do not sell personal information."],
  ["2. Without an account (local mode)", "Your movie library, ratings, predictions, comments drafts, display handle, and settings are stored locally in your browser's storage on your device and are not transmitted to our servers."],
  ["3. With an account", "If you create an account, we store: (a) your email address and a securely hashed password, managed by our authentication provider — we never see or store your plaintext password; (b) your synced app data (library, ratings, predictions, settings, and display handle) linked to your account so it can follow you across devices; and (c) any lobby posts you make (your handle, comment text, and rating), which are public and visible to all users of the Service."],
  ["4. Where account data lives", "Account data is stored with Supabase, our database and authentication provider, which processes it on our behalf in professionally managed data centers. Their handling of infrastructure data is governed by their own privacy and security practices."],
  ["5. Local storage and staying signed in", "The Service uses your browser's local storage strictly to make the app work: saving your library and preferences between visits, keeping your sign-in session active so you stay logged in until you sign out, and — if you choose \"remember my email\" — storing your email address on that device to pre-fill the sign-in form. You can turn the email memory off with the checkbox on the sign-in page. We do not use advertising cookies or cross-site tracking."],
  ["6. Third-party resources", "To run, the Service loads fonts from Google Fonts and JavaScript libraries from public CDNs (such as unpkg.com and jsdelivr.com), fetches film information, artwork, and streaming availability from The Movie Database (TMDB) at api.themoviedb.org, and communicates with Supabase when account features are used. When your browser contacts those providers, they receive standard technical information such as your IP address and browser type, governed by their own privacy policies. We do not control those providers."],
  ["7. How we use your information", "We use the information described above only to operate the Service: authenticating you, syncing your data across your devices, and displaying lobby posts to other users. We do not use it for advertising, profiling, or sale to third parties."],
  ["8. Children", "The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided personal information, contact us and we will delete it."],
  ["9. Your choices and deletion", "Local mode: clearing your browser's site data for NerdOutLoud permanently deletes locally stored information. Accounts: you can sign out at any time, and you can request deletion of your account, synced data, and lobby posts by contacting us at [YOUR CONTACT EMAIL]; we will act on verified requests within a reasonable time. Note that lobby posts are public while they exist, and other users may have seen them before deletion."],
  ["10. Security", "Passwords are hashed using industry-standard methods by our authentication provider, account data is protected by per-user access rules at the database level, and connections use encryption in transit. No method of storage or transmission is 100% secure; data kept in your browser is additionally protected only by your device's own security."],
  ["11. Changes to this policy", "If we add features that change how data is handled, we will update this policy and its effective date before those features go live."],
  ["12. Contact", "Privacy questions or requests: [YOUR CONTACT EMAIL]."],
];

const LEGAL_ACCESS = [
  ["1. Our commitment", "We want NerdOutLoud to be usable by everyone, including people who use assistive technologies such as screen readers, switch devices, or keyboard-only navigation. Accessibility is treated as an ongoing effort, not a one-time checkbox."],
  ["2. Standard we aim for", "Our target is conformance with the Web Content Accessibility Guidelines (WCAG) 2.1, Level AA. The Service has not yet undergone a formal third-party accessibility audit, and we consider it partially conformant: some parts may not yet fully meet the standard."],
  ["3. What is in place today", "The Service currently includes: respect for your device's reduced-motion preference (animations are disabled when it is set); text labels or ARIA labels on icon-only controls; keyboard-operable buttons and form controls; enlarged touch targets on touchscreens; responsive layouts and scalable text that adapt to small screens and zoom; and decorative graphics marked as hidden from assistive technology."],
  ["4. Known limitations", "Areas we are still improving include: full screen-reader testing across all flows; color contrast in a small number of decorative elements; some information conveyed partly by color (such as verdict badges), which we plan to supplement with text in all cases; and user-posted lobby content, which we cannot guarantee is accessible."],
  ["5. Feedback and assistance", "If you encounter a barrier that prevents you from using any part of NerdOutLoud, please tell us at [YOUR CONTACT EMAIL]. Include the page or feature, your device and assistive technology if applicable, and what went wrong. We will make reasonable efforts to respond promptly and to fix verified issues or provide the information you needed in an accessible way."],
  ["6. Compatibility", "The Service is designed for current versions of major browsers (Chrome, Safari, Firefox, Edge) on desktop and mobile. It may not function correctly in outdated browsers."],
  ["7. Continuous improvement", "As features are added, we will review them against this statement and update it, including its effective date, to reflect the current state of the Service."],
];

function LegalPage({ initialTab }) {
  const [tab, setTab] = useState(["privacy", "access"].includes(initialTab) ? initialTab : "terms");
  const doc = tab === "terms" ? LEGAL_TERMS : tab === "privacy" ? LEGAL_PRIVACY : LEGAL_ACCESS;
  const title = tab === "terms" ? "Terms of service" : tab === "privacy" ? "Privacy policy" : "Accessibility statement";
  return (
    <div className="nol-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="The fine print" title={title} sub={`Effective ${LEGAL_EFFECTIVE}`} />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <button className={`nol-seg${tab === "terms" ? " on" : ""}`} onClick={() => setTab("terms")}>Terms</button>
        <button className={`nol-seg${tab === "privacy" ? " on" : ""}`} onClick={() => setTab("privacy")}>Privacy</button>
        <button className={`nol-seg${tab === "access" ? " on" : ""}`} onClick={() => setTab("access")}>Accessibility</button>
      </div>
      <div style={{
        background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: "20px 22px",
        boxShadow: "0 4px 18px rgba(0,0,0,0.3)",
      }}>
        {doc.map(([h, p], i) => (
          <div key={i} style={{ marginBottom: i < doc.length - 1 ? 18 : 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 5 }}>{h}</div>
            <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.65, margin: 0 }}>{p}</p>
          </div>
        ))}
      </div>
      <p style={{ color: C.faint, fontSize: 12, lineHeight: 1.6, marginTop: 16, textAlign: "center" }}>
        NerdOutLoud is not affiliated with any streaming service. All trademarks and film titles belong to their respective owners.
      </p>
    </div>
  );
}

function Empty({ text }) {
  return <p style={{ color: C.muted, textAlign: "center", padding: "40px 20px", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>{text}</p>;
}

export default function NerdOutLoud() {
  const [state, setState] = useState(null);
  const [view, setView] = useState("home");
  const [legalTab, setLegalTab] = useState("terms");
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [accountMode, setAccountMode] = useState("signin");
  const [notifOpen, setNotifOpen] = useState(false);
  const [jumpFilmId, setJumpFilmId] = useState(null);
  const [members, setMembers] = useState([]);
  const loaded = useRef(false);
  const syncedFor = useRef(null);
  const stateRef = useRef(null);
  stateRef.current = state;
  const notifications = (state && state.notifications) || [];

  // Notifications persist into the same saved state as everything else, so they
  // survive a refresh (and follow a signed-in patron across devices) instead of
  // vanishing the moment the page reloads.
  const pushNotification = (n) => {
    setState(s => {
      if (!s) return s;
      const next = [
        { id: Date.now() + Math.random(), read: false, ts: Date.now(), ...n },
        ...(s.notifications || []),
      ].slice(0, 30);
      return { ...s, notifications: next };
    });
  };

  useEffect(() => {
    (async () => {
      const raw = await store.get("nol-state-v1");
      let parsed = null;
      if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }
      setState(parsed
        ? { night: null, services: [...ALL_SERVICES], handle: "", vetoesLeft: 2, notifications: [], notifSeen: { trending: [], svc: {} }, nightLog: [], ...parsed }
        : SEED);
      loaded.current = true;
    })();
    if (cloud.enabled()) cloud.logPageview();
  }, []);

  useEffect(() => {
    if (!cloud.enabled()) return;
    cloud.getUser().then(u => setUser(u));
    const off = cloud.onAuthChange((u, event) => {
      setUser(u);
      if (event === "PASSWORD_RECOVERY") setView("reset-password");
    });
    return off;
  }, []);

  // When a user signs in: pull their cloud state if it exists, otherwise seed it with local state.
  useEffect(() => {
    if (!user || !state || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    (async () => {
      const remote = await cloud.loadState(user.id);
      const finalHandle = remote && remote.handle ? remote.handle : state.handle;
      if (remote) setState({ ...SEED, ...remote });
      else cloud.saveState(user.id, state);
      if (finalHandle) cloud.upsertMember(user.id, finalHandle); // keeps the welcome spotlight in sync
    })();
  }, [user, state == null]);

  useEffect(() => {
    if (!loaded.current || !state) return;
    store.set("nol-state-v1", JSON.stringify(state));
    if (user) {
      cloud.saveState(user.id, state);
      // Belt-and-suspenders: if an earlier race ever wrote an empty handle, this
      // re-asserts the real one every time state changes, so it self-heals.
      if (state.handle) cloud.upsertMember(user.id, state.handle);
    }
  }, [state, user]);

  const saveHandle = (h) => {
    setState(s => ({ ...s, handle: h }));
    if (user) cloud.upsertMember(user.id, h);
  };

  // Welcome spotlight: newest patrons, refreshed on load and updated live as people join.
  useEffect(() => {
    if (!cloud.enabled()) return;
    let on = true;
    cloud.recentMembers(10).then(rows => { if (on && rows) setMembers(rows); }).catch(() => { /* quiet */ });
    const off = cloud.subscribeMembers((row) => {
      if (!row) return;
      setMembers(prev => [{ ...row, __fresh: true }, ...prev.filter(m => m.user_id !== row.user_id)].slice(0, 10));
      pushNotification({ type: "member", title: `Welcome our newest patron: ${row.handle}`, sub: "Say hi in a lobby 🎬" });
    });
    return () => { on = false; off(); };
  }, []);


  // Live notifications: replies to your comments, and new comments/ratings on films
  // you've watched — arrives instantly while the site is open, via Supabase Realtime.
  useEffect(() => {
    if (!cloud.enabled() || !user) return;
    const onInsert = async (row) => {
      if (!row || row.user_id === user.id) return;
      const myFilms = stateRef.current ? stateRef.current.films : [];
      let notif = null;
      if (row.parent_id) {
        const parent = await cloud.getCommentOwner(row.parent_id);
        if (parent && parent.user_id === user.id) {
          notif = { type: "reply", title: `${row.handle} replied to your comment`, sub: row.body || "", filmSlug: row.film_slug };
        }
      }
      if (!notif) {
        const f = myFilms.find(x => slugify(x.n) === row.film_slug && (x.status === "watched" || x.rating != null));
        if (f) {
          const sub = row.body ? row.body : (row.rating != null ? `Rated it ${Number(row.rating).toFixed(1)}` : "");
          notif = { type: "comment", title: `${row.handle} commented on ${f.n}`, sub, filmSlug: row.film_slug };
        }
      }
      if (notif) pushNotification(notif);
    };
    const off = cloud.subscribeLobby(onInsert);
    return off;
  }, [user]);

  // Once per app load: a quiet digest of new trending titles you haven't been told about yet.
  // "Seen" tracking lives in synced account state now (not local-only storage), so it can't
  // get wiped by a storage reset and start re-announcing the same titles as "new" again.
  useEffect(() => {
    if (!tmdb.enabled() || !state) return;
    (async () => {
      try {
        const items = await tmdb.trending();
        if (!items || !items.length) return;
        const seen = (state.notifSeen && state.notifSeen.trending) || null;
        const ids = items.map(t => t.tid);
        if (seen) {
          const seenSet = new Set(seen);
          const fresh = items.filter(t => !seenSet.has(t.tid));
          if (fresh.length) {
            pushNotification({
              type: "trending",
              title: `${fresh.length} new movie${fresh.length === 1 ? "" : "s"} added to Trending`,
              sub: fresh.slice(0, 3).map(f => f.n).join(", ") + (fresh.length > 3 ? ", …" : ""),
            });
          }
        }
        setState(s => s ? { ...s, notifSeen: { ...(s.notifSeen || {}), trending: ids.slice(-200) } } : s);
      } catch { /* quiet */ }
    })();
  }, [state == null]);

  // Once per app load, per selected service: a digest of newly-appeared streaming titles.
  useEffect(() => {
    if (!tmdb.enabled() || !state) return;
    const svcs = (state.services || []).filter(s => TMDB_PROVIDERS[s]);
    let cancelled = false;
    (async () => {
      for (const svc of svcs) {
        if (cancelled) return;
        try {
          const items = await tmdb.discoverByService(svc);
          if (!items || !items.length) continue;
          const seen = (state.notifSeen && state.notifSeen.svc && state.notifSeen.svc[svc]) || null;
          const ids = items.map(t => t.tmdbId);
          if (seen) {
            const seenSet = new Set(seen);
            const fresh = items.filter(t => !seenSet.has(t.tmdbId));
            if (fresh.length) {
              pushNotification({
                type: "service",
                title: `New on ${svc}: ${fresh.length} title${fresh.length === 1 ? "" : "s"} just added`,
                sub: fresh.slice(0, 3).map(f => f.n).join(", ") + (fresh.length > 3 ? ", …" : ""),
              });
            }
          }
          setState(s => s ? {
            ...s,
            notifSeen: { ...(s.notifSeen || {}), svc: { ...((s.notifSeen && s.notifSeen.svc) || {}), [svc]: ids.slice(0, 300) } },
          } : s);
        } catch { /* quiet, move to next service */ }
      }
    })();
    return () => { cancelled = true; };
  }, [state == null]);

  const markAllRead = () => setState(s => s ? { ...s, notifications: [] } : s);
  const onClickNotif = (n) => {
    setState(s => s ? { ...s, notifications: (s.notifications || []).filter(x => x.id !== n.id) } : s);
    setNotifOpen(false);
    if (n.filmSlug) {
      const f = state.films.find(f2 => slugify(f2.n) === n.filmSlug);
      if (f) { setJumpFilmId(f.id); setView("board"); return; }
    }
    setView(n.type === "reply" || n.type === "comment" ? "board" : "home");
  };

  if (!state) {
    return (
      <div className="nol-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, letterSpacing: "0.3em", color: C.amber }}>ROLLING FILM…</span>
      </div>
    );
  }

  const gated = cloud.enabled() && !user;
  const isAdmin = !!(ADMIN_EMAIL && user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  const goSignup = () => { setAccountMode("signup"); setView("account"); };
  const goSignin = () => { setAccountMode("signin"); setView("account"); };

  return (
    <div className="nol-root" style={{ paddingBottom: 30 }}>
      <style>{GLOBAL_CSS}</style>
      <TopBar goHome={() => setView("home")} openMenu={() => setMenuOpen(true)} nightActive={!!state.night}
        unreadCount={notifications.length} onOpenNotifs={cloud.enabled() ? () => setNotifOpen(true) : null} />
      <NotifPanel open={notifOpen} close={() => setNotifOpen(false)} notifications={notifications}
        onClickNotif={onClickNotif} onDismiss={(n) => setState(s => s ? { ...s, notifications: (s.notifications || []).filter(x => x.id !== n.id) } : s)}
        onMarkAllRead={markAllRead} />
      <Menu open={menuOpen} close={() => setMenuOpen(false)} view={view} nightActive={!!state.night} state={state} user={user}
        go={(k) => {
          if (k === "account-signup") { setAccountMode("signup"); setView("account"); }
          else if (k === "account-signin" || k === "account") { setAccountMode("signin"); setView("account"); }
          else setView(k);
        }} />
      {view === "home" && <><Marquee /><FilmStrip /><HowItWorks /><WelcomeSpotlight members={members} /></>}
      <main style={{ paddingTop: 6 }}>
        {view === "home" && (state.night
          ? <NightFlow state={state} setState={setState} user={user} gated={gated} goSignup={goSignup} />
          : <>
              <Picker state={state} setState={setState} user={user} />
              {!gated && <TrackRecord state={state} setState={setState} user={user} />}
            </>)}
        {view === "board" && (gated
          ? <GatePage what="Nerdmunity — chat, discussions, and the film lobbies" onSignup={goSignup} onSignin={goSignin} />
          : <BoardPage state={state} setState={setState} user={user} goAccount={() => setView("account")} jumpFilmId={jumpFilmId} clearJump={() => setJumpFilmId(null)} />)}
        {view === "library" && (gated
          ? <GatePage what="your watchlist, ranking, and the every-movie search" onSignup={goSignup} onSignin={goSignin} />
          : <Library state={state} setState={setState} goToFilm={(id) => { setJumpFilmId(id); setView("board"); }} />)}
        {view === "account" && <AccountPage key={accountMode} user={user} initialMode={accountMode} handle={state.handle} saveHandle={saveHandle} onDone={() => setView("home")} />}
        {view === "reset-password" && <ResetPasswordPage onDone={() => setView("home")} />}
        {view === "admin" && isAdmin && <AdminPage />}
        {view === "legal" && <LegalPage key={legalTab} initialTab={legalTab} />}
      </main>
      <footer style={{ textAlign: "center", padding: "26px 16px 12px" }}>
        <div style={{ color: C.faint, fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 10 }}>
          A NerdOutLoud production
        </div>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", marginBottom: 8 }}>
          <span className="nol-danger-link" style={{ textDecoration: "underline" }}
            onClick={() => { setLegalTab("terms"); setView("legal"); }}>Terms of service</span>
          <span className="nol-danger-link" style={{ textDecoration: "underline" }}
            onClick={() => { setLegalTab("privacy"); setView("legal"); }}>Privacy policy</span>
          <span className="nol-danger-link" style={{ textDecoration: "underline" }}
            onClick={() => { setLegalTab("access"); setView("legal"); }}>Accessibility</span>
        </div>
        <p style={{ color: C.faint, fontSize: 11, lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
          Not affiliated with, endorsed by, or sponsored by Netflix, Prime Video, Max, Hulu, Disney+, Tubi, or any other streaming service. All trademarks and film titles belong to their respective owners.
        </p>
        <p style={{ color: C.faint, fontSize: 11, lineHeight: 1.6, maxWidth: 460, margin: "6px auto 0" }}>
          Movie data powered by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <p style={{ color: C.faint, fontSize: 11, lineHeight: 1.6, margin: "10px auto 0" }}>
          © {new Date().getFullYear()} NerdOutLoud™. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
