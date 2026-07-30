import { createClient } from "@supabase/supabase-js";

// ---------- Accounts & cloud sync (Supabase) ----------
// Configured via environment variables (see .env.example) so different
// environments can point at different Supabase projects without a code
// change. Falls back to the current live values if the env vars aren't set,
// so this stays a safe, non-breaking change for the existing deploy.
//
// Honest note: the Supabase anon key is a *publishable* key by design — safe
// to ship in the page regardless of whether it's hardcoded or pulled from an
// env var, since Vite inlines VITE_* variables into the built JS at build
// time either way. Moving it here is about configuration hygiene, not
// security — unlike TMDB_KEY/OMDB_KEY, which stay server-only in the
// Netlify Functions specifically because those keys are NOT meant to be public.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://bymmifuxvrhomqiisntv.supabase.co";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_qmC0F04efpUP-FuEJ60Qcw_zgf7ITtN";
// The one account allowed to see the analytics dashboard. Must match the email
// you sign in with AND the email in the SQL policy in SETUP-ACCOUNTS.md — both
// have to agree, or the dashboard stays hidden/blocked. Leave blank to disable it entirely.
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "cyber1patriot@gmail.com";

export const cloud = (() => {
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
    // Reuses the same nol_events table already built for analytics — a reaction
    // is just another event, so this avoids needing a new table or a database-level
    // REPLICA IDENTITY change just to diff old/new reaction counts on every update.
    subscribeReactions(onInsert) {
      const c = ready(); if (!c) return () => {};
      try {
        const channel = c.channel("nol_reactions_live")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "nol_events", filter: "event_type=eq.reaction" }, (payload) => onInsert(payload.new))
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
    // How many vetoes people actually burn before committing to a pick — helps
    // answer "would raising the veto limit actually help, or is 2 already plenty?"
    async logVetoUsage(vetoesUsed) {
      const c = ready(); if (!c) return;
      try { await c.from("nol_veto_stats").insert({ vetoes_used: vetoesUsed }); } catch { /* ignore */ }
    },
    async getVetoStats() {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_veto_stats").select("vetoes_used").limit(10000);
        if (error) return null;
        const counts = { 0: 0, 1: 0, 2: 0 };
        (data || []).forEach(r => { if (r.vetoes_used in counts) counts[r.vetoes_used]++; });
        return { ...counts, total: (data || []).length };
      } catch { return null; }
    },
    // A single flexible events table instead of a new dedicated table per metric —
    // logs spins, commits, completed ratings, and In Theaters button engagement,
    // and makes adding a future metric a one-line change instead of a new migration.
    async logEvent(eventType, meta) {
      const c = ready(); if (!c) return;
      try { await c.from("nol_events").insert({ event_type: eventType, meta: meta || {} }); } catch { /* ignore */ }
    },
    async getEventStats() {
      const c = ready(); if (!c) return null;
      try {
        const { data, error } = await c.from("nol_events").select("event_type,meta").limit(20000);
        if (error) return null;
        const rows = data || [];
        const spins = rows.filter(r => r.event_type === "spin");
        const commits = rows.filter(r => r.event_type === "commit");
        const ratings = rows.filter(r => r.event_type === "rating_submitted");
        const theaterActions = rows.filter(r => r.event_type === "theater_action");
        const bySource = (list) => {
          const out = { taste: 0, trending: 0, watchlist: 0, rewatch: 0 };
          list.forEach(r => { const s = r.meta && r.meta.source; if (s in out) out[s]++; });
          return out;
        };
        const byAction = { overview: 0, trailer: 0, tickets: 0, release: 0 };
        theaterActions.forEach(r => { const a = r.meta && r.meta.action; if (a in byAction) byAction[a]++; });
        return {
          spinCount: spins.length, commitCount: commits.length, ratingCount: ratings.length,
          spinsBySource: bySource(spins), commitsBySource: bySource(commits),
          theaterActionCount: theaterActions.length, byAction,
        };
      } catch { return null; }
    },
    // How many genuinely new users (first spin ever, this browser/account) actually
    // tried the core feature — a real activation signal, distinct from raw spin volume.
    async getNewUserPickerStats() {
      const c = ready(); if (!c) return null;
      try {
        const { count: total, error: e1 } = await c.from("nol_events").select("*", { count: "exact", head: true }).eq("event_type", "new_user_first_spin");
        if (e1) return null;
        const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
        const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const { count: last7 } = await c.from("nol_events").select("*", { count: "exact", head: true }).eq("event_type", "new_user_first_spin").gte("created_at", since7);
        const { count: last30 } = await c.from("nol_events").select("*", { count: "exact", head: true }).eq("event_type", "new_user_first_spin").gte("created_at", since30);
        return { total, last7, last30 };
      } catch { return null; }
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
