import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { store } from "./lib/store.js";
import { ADMIN_EMAIL, cloud } from "./lib/supabaseClient.js";
import { TMDB_PROVIDERS, tmdb } from "./lib/tmdb.js";
import { ALL_SERVICES, SEED, C } from "./lib/constants.js";
import { slugify } from "./lib/utils.js";
import { GLOBAL_CSS } from "./styles/globalStyles.js";
import { FilmStrip, HowItWorks, TopBar, NotifPanel, Menu, Marquee } from "./components/Shared.jsx";
import { WelcomeSpotlight } from "./components/CommunityFeatures.jsx";
import { Picker } from "./components/Picker.jsx";
import { TrackRecord } from "./components/TrackRecord.jsx";
import { GatePage } from "./components/GatePage.jsx";

// Route-gated views only needed after navigating away from home — not part of
// the initial bundle, so first load stays fast even as the app keeps growing.
const NightFlow = lazy(() => import("./components/NightFlow.jsx").then(m => ({ default: m.NightFlow })));
const TheatersPage = lazy(() => import("./components/TheatersPage.jsx").then(m => ({ default: m.TheatersPage })));
const BoardPage = lazy(() => import("./components/BoardPage.jsx").then(m => ({ default: m.BoardPage })));
const Library = lazy(() => import("./components/Library.jsx").then(m => ({ default: m.Library })));
const AccountPage = lazy(() => import("./components/Account.jsx").then(m => ({ default: m.AccountPage })));
const ResetPasswordPage = lazy(() => import("./components/Account.jsx").then(m => ({ default: m.ResetPasswordPage })));
const AdminPage = lazy(() => import("./components/Account.jsx").then(m => ({ default: m.AdminPage })));
const LegalPage = lazy(() => import("./components/LegalPage.jsx").then(m => ({ default: m.LegalPage })));

function RouteFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "60px 20px" }}>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.1em", color: C.faint, fontSize: 14 }}>
        LOADING…
      </span>
    </div>
  );
}

// Maps internal view state to public-facing, shareable URL hashes. Keeps the
// internal "board" key (used throughout the codebase already) separate from
// the public-facing "lobby" URL slug, since the feature is branded The Lobby.
const VIEW_TO_HASH = { home: "", theaters: "theaters", board: "lobby", library: "library", account: "account", admin: "admin", legal: "legal" };
const HASH_TO_VIEW = Object.fromEntries(Object.entries(VIEW_TO_HASH).map(([v, h]) => [h, v]));

function viewFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  return HASH_TO_VIEW[hash] || "home";
}

export default function REELmunity() {
  const [state, setState] = useState(null);
  const [view, setView] = useState(viewFromHash);
  const [legalTab, setLegalTab] = useState("terms");
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [accountMode, setAccountMode] = useState("signin");
  const [notifOpen, setNotifOpen] = useState(false);
  const [jumpFilmId, setJumpFilmId] = useState(null);
  const [members, setMembers] = useState([]);
  const loaded = useRef(false);

  // Keep the URL in sync with the current view — lets people bookmark, share,
  // or use the browser back/forward buttons to move between sections, and
  // gives ad sitelinks a real, distinct destination to point to instead of
  // every link landing on the same homepage regardless of which was clicked.
  useEffect(() => {
    const targetHash = VIEW_TO_HASH[view] ?? "";
    const currentHash = window.location.hash.replace(/^#/, "");
    if (currentHash !== targetHash) {
      const url = targetHash ? `#${targetHash}` : window.location.pathname + window.location.search;
      window.history.pushState(null, "", url);
    }
  }, [view]);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);
  const syncedFor = useRef(null);
  const syncingRef = useRef(false);
  const [syncSettled, setSyncSettled] = useState(false);
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
      // Backfill: anyone who already has committed picks before this feature existed
      // is clearly not "new" — don't let them get logged as a first-time user later.
      const alreadyActive = !!(parsed && parsed.spins && parsed.spins.committed > 0);
      setState(parsed
        ? { night: null, services: [...ALL_SERVICES], handle: "", vetoesLeft: 2, notifications: [], notifSeen: { trending: [], svc: {} }, nightLog: [], everSpun: alreadyActive, ...parsed }
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
    if (!user) { setSyncSettled(true); return; } // local mode — no sync will ever happen, don't block digests on it
    if (!state || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    syncingRef.current = true; // pause the general save effect below until this merge finishes —
    // otherwise it can race ahead and push a stale, pre-merge snapshot up to the cloud first.
    setSyncSettled(false); // a fresh sync is starting — digests must wait for this one too, not reuse an earlier "settled" from before this sign-in
    const localNotifs = state.notifications || [];
    const localFilms = state.films || [];
    const localSeen = state.notifSeen || { trending: [], svc: {} };
    (async () => {
      const remote = await cloud.loadState(user.id);
      const finalHandle = remote && remote.handle ? remote.handle : state.handle;
      if (remote) {
        // Never let the cloud copy silently drop a notification that showed up locally
        // but hasn't finished syncing up yet — merge instead of blindly overwriting.
        const remoteNotifs = remote.notifications || [];
        const remoteIds = new Set(remoteNotifs.map(n => n.id));
        const mergedNotifs = [...remoteNotifs, ...localNotifs.filter(n => !remoteIds.has(n.id))]
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 30);
        // Same protection for ratings: if a film was just rated locally and the cloud
        // hasn't caught up yet, don't let the stale remote copy wipe that rating back out.
        const remoteFilms = remote.films || [];
        const remoteFilmIds = new Set(remoteFilms.map(f => f.id));
        const mergedFilms = remoteFilms.map(rf => {
          const lf = localFilms.find(x => x.id === rf.id);
          if (lf && lf.rating != null && rf.rating == null) {
            return { ...rf, rating: lf.rating, status: lf.status, note: lf.note || rf.note };
          }
          return rf;
        });
        const onlyLocalFilms = localFilms.filter(f => !remoteFilmIds.has(f.id));
        // Same protection for the "already told you about this" tracking — this is
        // the exact data that stops trending/service digests from repeating, so if
        // IT gets reverted to a stale copy, the app starts re-announcing things it
        // already showed you. Union the seen-ids instead of trusting either side alone.
        const remoteSeen = remote.notifSeen || { trending: [], svc: {} };
        const mergedTrendingSeen = Array.from(new Set([...(remoteSeen.trending || []), ...(localSeen.trending || [])])).slice(-200);
        const mergedSvcSeen = { ...(remoteSeen.svc || {}) };
        Object.keys(localSeen.svc || {}).forEach(svc => {
          const combined = new Set([...(mergedSvcSeen[svc] || []), ...(localSeen.svc[svc] || [])]);
          mergedSvcSeen[svc] = Array.from(combined).slice(0, 300);
        });
        syncingRef.current = false; // safe to let the general save effect resume now
        setState({
          ...SEED, ...remote, notifications: mergedNotifs, films: [...mergedFilms, ...onlyLocalFilms],
          notifSeen: { trending: mergedTrendingSeen, svc: mergedSvcSeen },
        });
      } else {
        syncingRef.current = false;
        cloud.saveState(user.id, state);
      }
      if (finalHandle) cloud.upsertMember(user.id, finalHandle); // keeps the welcome spotlight in sync
      // Only now is state guaranteed to reflect the true, merged "already seen" data —
      // safe for the trending/service digest effects below to read it.
      setSyncSettled(true);
    })();
  }, [user, state == null]);

  useEffect(() => {
    if (!loaded.current || !state || syncingRef.current) return;
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
      const isAdminUser = !!(ADMIN_EMAIL && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
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
          const hasText = !!row.body;
          const title = hasText ? `${row.handle} commented on ${f.n}` : `${row.handle} rated ${f.n}`;
          const sub = hasText ? row.body : (row.rating != null ? `${Number(row.rating).toFixed(1)} / 10` : "");
          notif = { type: hasText ? "comment" : "rating", title, sub, filmSlug: row.film_slug };
        }
      }
      // Admin sees every post site-wide, not just activity on films they've personally
      // watched/rated — otherwise the site owner has no visibility into new patrons'
      // activity on films that aren't in their own library.
      if (!notif && isAdminUser) {
        const hasText = !!row.body;
        const title = hasText ? `${row.handle} commented (new patron activity)` : `${row.handle} rated a film`;
        const sub = hasText ? row.body : (row.rating != null ? `${Number(row.rating).toFixed(1)} / 10` : "");
        notif = { type: hasText ? "comment" : "rating", title, sub, filmSlug: row.film_slug };
      }
      if (notif) pushNotification(notif);
    };
    const off = cloud.subscribeLobby(onInsert);
    return off;
  }, [user]);

  // Live notifications: someone reacted to a post of yours. Reuses the same
  // events table analytics already writes to — see subscribeReactions in
  // supabaseClient.js for why (avoids a whole new table just for this).
  useEffect(() => {
    if (!cloud.enabled() || !user) return;
    const off = cloud.subscribeReactions((row) => {
      const meta = row && row.meta;
      if (!meta || meta.postOwnerId !== user.id) return;
      pushNotification({
        type: "reaction",
        title: `${meta.reactorHandle || "Someone"} reacted ${meta.emoji || ""} to your post`,
        sub: "", filmSlug: meta.filmSlug,
      });
    });
    return off;
  }, [user]);

  // Once per app load: a quiet digest of new trending titles you haven't been told about yet.
  // "Seen" tracking lives in synced account state now (not local-only storage), so it can't
  // get wiped by a storage reset and start re-announcing the same titles as "new" again.
  useEffect(() => {
    if (!tmdb.enabled() || !state || !syncSettled) return;
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
  }, [syncSettled]);

  // Once per app load, per selected service: a digest of newly-appeared streaming titles.
  useEffect(() => {
    if (!tmdb.enabled() || !state || !syncSettled) return;
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
  }, [syncSettled]);

  const markAllRead = () => setState(s => s ? { ...s, notifications: (s.notifications || []).map(n => ({ ...n, read: true })) } : s);
  const clearAllNotifs = () => setState(s => s ? { ...s, notifications: [] } : s);
  const dismissNotif = (n) => setState(s => s ? { ...s, notifications: (s.notifications || []).filter(x => x.id !== n.id) } : s);
  const onClickNotif = (n) => {
    setState(s => s ? { ...s, notifications: (s.notifications || []).map(x => x.id === n.id ? { ...x, read: true } : x) } : s);
    if (n.filmSlug) {
      const f = state.films.find(f2 => slugify(f2.n) === n.filmSlug);
      if (f) { setJumpFilmId(f.id); setView("board"); return; }
    }
    setView(n.type === "reply" || n.type === "comment" || n.type === "rating" || n.type === "reaction" ? "board" : "home");
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
        unreadCount={notifications.filter(n => !n.read).length} onOpenNotifs={cloud.enabled() ? () => setNotifOpen(true) : null} />
      <NotifPanel open={notifOpen} close={() => setNotifOpen(false)} notifications={notifications}
        onClickNotif={onClickNotif} onDismiss={dismissNotif}
        onMarkAllRead={markAllRead} onClearAll={clearAllNotifs} />
      <Menu open={menuOpen} close={() => setMenuOpen(false)} view={view} nightActive={!!state.night} state={state} user={user}
        go={(k) => {
          if (k === "account-signup") { setAccountMode("signup"); setView("account"); }
          else if (k === "account-signin" || k === "account") { setAccountMode("signin"); setView("account"); }
          else setView(k);
        }} />
      {view === "home" && <><Marquee /><FilmStrip /><HowItWorks /><WelcomeSpotlight members={members} /></>}
      <main style={{ paddingTop: 6 }}>
        <Suspense fallback={<RouteFallback />}>
          {view === "home" && (state.night
            ? <NightFlow state={state} setState={setState} user={user} gated={gated} goSignup={goSignup} />
            : <>
                <Picker state={state} setState={setState} user={user} />
                {!gated && <TrackRecord state={state} setState={setState} user={user} />}
              </>)}
          {view === "theaters" && <TheatersPage />}
          {view === "board" && (gated
            ? <GatePage what="The Lobby — chat, discussions, and the film screening rooms" onSignup={goSignup} onSignin={goSignin} />
            : <BoardPage state={state} setState={setState} user={user} goAccount={() => setView("account")} jumpFilmId={jumpFilmId} clearJump={() => setJumpFilmId(null)} />)}
          {view === "library" && (gated
            ? <GatePage what="your watchlist, ranking, and the every-movie search" onSignup={goSignup} onSignin={goSignin} />
            : <Library state={state} setState={setState} goToFilm={(id) => { setJumpFilmId(id); setView("board"); }} />)}
          {view === "account" && <AccountPage key={accountMode} user={user} initialMode={accountMode} handle={state.handle} saveHandle={saveHandle} onDone={() => setView("home")} />}
          {view === "reset-password" && <ResetPasswordPage onDone={() => setView("home")} />}
          {view === "admin" && isAdmin && <AdminPage />}
          {view === "legal" && <LegalPage key={legalTab} initialTab={legalTab} />}
        </Suspense>
      </main>
      <footer style={{ textAlign: "center", padding: "26px 16px 12px" }}>
        <div style={{ color: C.faint, fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 10 }}>
          A REELmunity production
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
          © {new Date().getFullYear()} REELmunity™. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
