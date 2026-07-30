import React, { useState, useEffect } from "react";
import { store } from "../lib/store.js";
import { ADMIN_EMAIL, cloud } from "../lib/supabaseClient.js";
import { tmdb } from "../lib/tmdb.js";
import { C } from "../lib/constants.js";
import { slugify, postToLobby } from "../lib/utils.js";
import { RatingSlider, Avatar, REACTIONS } from "./Shared.jsx";

export function Lobby({ film, handle, saveHandle, user, goAccount, setFilmPoster, onRate, refreshCommunity }) {
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
    const patron = user && handle ? handle : (name.trim() || "Anonymous patron");
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
      // Only notify on a genuine new reaction (not removing one), and never
      // notify someone for reacting to their own post.
      if (!already && m.uid && (!user || m.uid !== user.id)) {
        cloud.logEvent("reaction", { postOwnerId: m.uid, emoji, reactorHandle: (user && handle) || name.trim() || "Anonymous patron", filmSlug: slugify(film.n) });
      }
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
        <span style={{ fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", color: C.amber }}>The Screening Room</span>
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

      {msgs == null && <p style={{ color: C.faint, fontSize: 13, margin: "0 0 10px" }}>Opening the screening room…</p>}
      {msgs != null && all.length === 0 && (
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 10px" }}>
          No takes yet. Be the first voice in the room.
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
