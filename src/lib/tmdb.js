import { store } from "./store.js";
import { slugify } from "./utils.js";

export function tmdbProxy(path, params) {
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
export function tmdbMood(genreIds) {
  for (const g of (genreIds || [])) { if (TMDB_GENRE_KEY[g]) return TMDB_GENRE_KEY[g]; }
  return "drama";
}

export function tmdbSvc(wp) {
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

export function tmdbToFilm(d) {
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
    tmdbId: d.id,
  };
}

export const TMDB_PROVIDERS = { Netflix: 8, Prime: 9, Max: 1899, Hulu: 15, "Disney+": 337, Tubi: 73 };

export const tmdb = {
  enabled: () => true,
  async search(q) {
    const r = await fetch(tmdbProxy("/search/movie", { include_adult: "false", query: q }));
    if (!r.ok) throw new Error("search failed");
    const j = await r.json();
    return (j.results || []).slice(0, 8);
  },
  // Searching an actor/actress's name should surface their movies, not just
  // literal title matches — TMDB's movie search alone won't do that.
  async searchPerson(q) {
    try {
      const r = await fetch(tmdbProxy("/search/person", { include_adult: "false", query: q }));
      if (!r.ok) return null;
      const j = await r.json();
      const top = (j.results || [])[0];
      return top || null;
    } catch { return null; }
  },
  async personMovieCredits(personId) {
    try {
      const r = await fetch(tmdbProxy(`/person/${personId}/movie_credits`));
      if (!r.ok) return [];
      const j = await r.json();
      const cast = (j.cast || []).filter(m => m.poster_path || m.title);
      cast.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      return cast.slice(0, 8);
    } catch { return []; }
  },
  async filmDetails(id) {
    const r = await fetch(tmdbProxy(`/movie/${id}`, { append_to_response: "credits,watch/providers,release_dates" }));
    if (!r.ok) throw new Error("details failed");
    return r.json();
  },
  async trending() {
    try {
      const cached = await store.get("nol-tmdb-trending-v3");
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
        items[i] = { tid: "live" + m.id, tmdbId: m.id, heat: 100 - i * 3, poster: m.poster_path || null, ...tmdbToFilm(d) };
      } catch { /* skip this title */ }
    }));
    const clean = items.filter(Boolean);
    if (clean.length) {
      try { await store.set("nol-tmdb-trending-v3", JSON.stringify({ day: new Date().toDateString(), items: clean })); } catch { /* ignore */ }
    }
    return clean;
  },
  // Which movies are currently playing in US theaters — used to tell "still in
  // theaters" apart from "already streaming" in the trending strip.
  // Full film data for what's in theaters — powers both the trending-strip badge
  // matching (via nowPlayingIds below) and the dedicated "In Theaters" page.
  async nowPlayingList() {
    const cacheKey = "nol-tmdb-nowplaying-v3";
    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        const { day, items } = JSON.parse(cached);
        if (day === new Date().toDateString()) return items;
      }
    } catch { /* refetch */ }
    // One page is only 20 titles — there are usually 50-100+ movies actually in
    // US theaters at once, so a trending release can easily sit past page 1.
    let all = [];
    try {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(tmdbProxy("/movie/now_playing", { region: "US", page: String(page) }));
        if (!r.ok) break;
        const j = await r.json();
        all = all.concat(j.results || []);
        if (page >= (j.total_pages || 1)) break;
      }
    } catch { /* use whatever we got */ }
    const items = all.map(m => ({
      n: m.title || "Untitled", y: m.release_date ? Number(m.release_date.slice(0, 4)) : new Date().getFullYear(),
      poster: m.poster_path || null, tmdbId: m.id, syn: (m.overview || "").slice(0, 200),
    }));
    if (items.length) {
      try { await store.set(cacheKey, JSON.stringify({ day: new Date().toDateString(), items })); } catch { /* ignore */ }
    }
    return items;
  },
  async nowPlayingIds() {
    const items = await tmdb.nowPlayingList();
    return new Set(items.map(m => m.tmdbId));
  },
  // Same pattern, for films that haven't opened in theaters yet.
  async upcomingList() {
    const cacheKey = "nol-tmdb-upcoming-v6";
    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        const { day, items } = JSON.parse(cached);
        if (day === new Date().toDateString()) return items;
      }
    } catch { /* refetch */ }
    // Two earlier approaches both proved unreliable: /movie/upcoming reports each
    // film's ORIGINAL release date even when included for an unrelated reason (a
    // re-release, an anniversary screening), and combining discover's date filter
    // with with_release_type didn't actually restrict the match the way it's
    // documented to. The only trustworthy way to know a film has a real upcoming
    // US theatrical date is to check its own release_dates entries directly — so
    // that's what this does: gather candidates, then verify every one individually.
    let candidates = [];
    try {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(tmdbProxy("/movie/upcoming", { region: "US", page: String(page) }));
        if (!r.ok) break;
        const j = await r.json();
        candidates = candidates.concat(j.results || []);
        if (page >= (j.total_pages || 1)) break;
      }
    } catch { /* use whatever we got */ }

    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
    // A film's overall (primary) release date being more than ~2 years old is a strong
    // signal this "upcoming" theatrical entry is actually an anniversary or revival
    // screening (Willy Wonka, Train to Busan, etc. all get these), not a new release —
    // even though the screening date itself is technically real and in the future.
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
    const verified = [];
    const BATCH = 6;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (m) => {
        try {
          const d = await tmdb.filmDetails(m.id);
          if (d.release_date && d.release_date.slice(0, 10) < twoYearsAgo) return null;
          const usEntry = ((d.release_dates && d.release_dates.results) || []).find(r => r.iso_3166_1 === "US");
          const theatricalDates = usEntry
            ? usEntry.release_dates
                .filter(rd => (rd.type === 2 || rd.type === 3) && rd.release_date)
                .map(rd => rd.release_date.slice(0, 10))
                .filter(dt => dt >= today && dt <= cutoff)
            : [];
          if (!theatricalDates.length) return null;
          const soonest = theatricalDates.sort()[0];
          return {
            n: m.title || "Untitled", y: Number(soonest.slice(0, 4)), poster: m.poster_path || null,
            tmdbId: m.id, syn: (m.overview || "").slice(0, 200), releaseDate: soonest,
          };
        } catch { return null; }
      }));
      results.forEach(r => { if (r) verified.push(r); });
    }
    verified.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    if (verified.length) {
      try { await store.set(cacheKey, JSON.stringify({ day: new Date().toDateString(), items: verified })); } catch { /* ignore */ }
    }
    return verified;
  },
  // TMDB's /movie/upcoming is built entirely around theatrical release calendars —
  // everything in it already has a theatrical date by definition, so there's nothing
  // genuinely streaming-only to sort out of that list. Streaming-bound titles need
  // their own query: discover films whose *digital* release date (type 4) is still
  // ahead of today, which is a real, separate calendar TMDB tracks.
  async upcomingStreamList() {
    const cacheKey = "nol-tmdb-upcoming-stream-v3";
    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        const { day, items } = JSON.parse(cached);
        if (day === new Date().toDateString()) return items;
      }
    } catch { /* refetch */ }
    const today = new Date().toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
    let candidates = [];
    try {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(tmdbProxy("/discover/movie", {
          region: "US", with_release_type: "4", "release_date.gte": today, "release_date.lte": in90,
          sort_by: "popularity.desc", include_adult: "false", page: String(page),
        }));
        if (!r.ok) break;
        const j = await r.json();
        candidates = candidates.concat(j.results || []);
        if (page >= (j.total_pages || 1)) break;
      }
    } catch { /* use whatever we got */ }

    // Same fix as the theatrical list: verify each candidate directly against its
    // real release_dates rather than trusting discover's bulk filter, and exclude
    // old films whose digital "upcoming" date is actually a re-issue/anniversary
    // release rather than a genuinely new streaming premiere.
    const verified = [];
    const BATCH = 6;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (m) => {
        try {
          const d = await tmdb.filmDetails(m.id);
          if (d.release_date && d.release_date.slice(0, 10) < twoYearsAgo) return null;
          const usEntry = ((d.release_dates && d.release_dates.results) || []).find(r => r.iso_3166_1 === "US");
          const digitalDates = usEntry
            ? usEntry.release_dates
                .filter(rd => rd.type === 4 && rd.release_date)
                .map(rd => rd.release_date.slice(0, 10))
                .filter(dt => dt >= today && dt <= in90)
            : [];
          if (!digitalDates.length) return null;
          const soonest = digitalDates.sort()[0];
          return {
            n: m.title || "Untitled", y: Number(soonest.slice(0, 4)), poster: m.poster_path || null,
            tmdbId: m.id, syn: (m.overview || "").slice(0, 200), releaseDate: soonest,
          };
        } catch { return null; }
      }));
      results.forEach(r => { if (r) verified.push(r); });
    }
    verified.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    if (verified.length) {
      try { await store.set(cacheKey, JSON.stringify({ day: new Date().toDateString(), items: verified })); } catch { /* ignore */ }
    }
    return verified;
  },
  async upcomingIds() {
    const items = await tmdb.upcomingList();
    return new Set(items.map(m => m.tmdbId));
  },
  // The official trailer (YouTube key) for a film, if TMDB has one on file.
  async trailerKey(id) {
    try {
      const r = await fetch(tmdbProxy(`/movie/${id}/videos`));
      if (!r.ok) return null;
      const j = await r.json();
      const vids = j.results || [];
      const official = vids.find(v => v.site === "YouTube" && v.type === "Trailer" && v.official) ||
        vids.find(v => v.site === "YouTube" && v.type === "Trailer") ||
        vids.find(v => v.site === "YouTube");
      return official ? official.key : null;
    } catch { return null; }
  },
  // For "Coming Soon" titles: which streaming service it'll land on, and when —
  // TMDB's release_dates carry a "type" per country (4 = Digital/streaming release),
  // separate from the theatrical date already shown elsewhere. Cached per film per day.
  async streamingInfo(id) {
    const cacheKey = "nol-tmdb-streaminfo-v3-" + id;
    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        const { day, info } = JSON.parse(cached);
        if (day === new Date().toDateString()) return info;
      }
    } catch { /* refetch */ }
    let info = { svc: null, date: null, hasTheatrical: false };
    try {
      const d = await tmdb.filmDetails(id);
      const svc = tmdbSvc(d["watch/providers"]);
      const usEntry = ((d.release_dates && d.release_dates.results) || []).find(r => r.iso_3166_1 === "US");
      const allUsDates = usEntry ? usEntry.release_dates : [];
      // Only type 3 (wide theatrical) counts as "really coming to a theatre near you."
      // Type 2 (limited) alone is excluded on purpose — many streaming-exclusive films
      // still get a token one-week qualifying run in a few cities for awards eligibility,
      // and counting that would wrongly sweep pure streaming titles into the theatrical bucket.
      const hasTheatrical = allUsDates.some(rd => rd.type === 3);
      const digitalEntries = allUsDates.filter(rd => rd.type === 4);
      const digitalDate = digitalEntries.length
        ? digitalEntries.map(rd => rd.release_date).sort()[0].slice(0, 10)
        : null;
      info = { svc: svc === "Other" ? null : svc, date: digitalDate, hasTheatrical };
    } catch { /* leave defaults — treated as stream-only until we know more */ }
    try { await store.set(cacheKey, JSON.stringify({ day: new Date().toDateString(), info })); } catch { /* ignore */ }
    return info;
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
export const omdb = {
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

