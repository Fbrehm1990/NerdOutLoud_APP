import { MOODS } from "./constants.js";
import { store } from "./store.js";
import { cloud } from "./supabaseClient.js";

export function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export function calStats(state) {
  const done = state.predictions.filter(p => p.actual != null);
  const avgGap = done.length ? done.reduce((s, p) => s + Math.abs(p.pred - p.actual), 0) / done.length : null;
  const calibration = avgGap == null ? null : Math.max(0, Math.round(100 - avgGap * 15));
  return { done, avgGap, calibration };
}

// Consecutive calendar days (ending today or yesterday — a night is still "on
// streak" until you've fully skipped a day) with at least one completed night.
export function computeStreak(nightLog) {
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

export function tasteProfile(films) {
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

export function weightedPick(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export async function postToLobby(film, msg, user) {
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

// For anyone who'd rather not pick their own name at signup — every account
// still becomes a real patron either way, this just fills in the name half.
const PATRON_ADJ = [
  "Midnight", "Velvet", "Neon", "Vintage", "Silent", "Golden", "Curious",
  "Cinematic", "Nostalgic", "Devoted", "Retro", "Indie", "Classic",
  "Dramatic", "Legendary", "Casual", "Arthouse", "Cult",
];
const PATRON_NOUN = [
  "Viewer", "Critic", "Popcorn", "Marquee", "Matinee", "Usher", "Extra",
  "Cameo", "Sequel", "Premiere", "Encore", "Trailer", "Reel",
];
export function generatePatronName() {
  const adj = PATRON_ADJ[Math.floor(Math.random() * PATRON_ADJ.length)];
  const noun = PATRON_NOUN[Math.floor(Math.random() * PATRON_NOUN.length)];
  const num = Math.floor(Math.random() * 900) + 100; // 100-999, avoids awkward single digits
  return `${adj}${noun}${num}`;
}

// Best-effort only — TMDB's own community has asked for a real "belongs to a
// collection" filter on the bulk discover endpoint and it doesn't exist; that
// data is only available via an individual detail lookup per film, which
// isn't practical across a 1,000+ title catalog sweep. This falls back to
// recognizing common sequel naming patterns in the title itself instead:
// trailing Roman numerals, "Part Two"/"Chapter 2" style subtitles, and a
// trailing number after a real word (John Wick 4) while deliberately NOT
// matching bare numeric titles like "1917" or "300". It will miss sequels
// that use a colon-subtitle with no numbering at all (Top Gun: Maverick) and
// very occasionally flag a one-off film that happens to share a naming
// pattern — an approximation, not a guarantee.
export function looksLikeSeriesEntry(title) {
  const t = (title || "").trim();
  if (/\s(II|III|IV|V|VI|VII|VIII|IX|X)$/.test(t)) return true;
  if (/\bPart\s+(One|Two|Three|Four|Five|\d+)\b/i.test(t)) return true;
  if (/\bChapter\s+\d+\b/i.test(t)) return true;
  if (/[a-zA-Z]\s\d{1,2}$/.test(t)) return true;
  return false;
}

