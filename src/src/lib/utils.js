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

