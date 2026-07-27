import React, { useState, useEffect, useRef } from "react";
import { ADMIN_EMAIL, cloud } from "../lib/supabaseClient.js";
import { C } from "../lib/constants.js";
import { Avatar } from "./Shared.jsx";

export function WelcomeSpotlight({ members }) {
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
export function PatronBoard({ user, handle, goAccount }) {
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
    const patron = (handle || "Anonymous patron").slice(0, 24);
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
          {msgs == null && <p style={{ color: C.faint, fontSize: 13, textAlign: "center", margin: "10px 0" }}>Opening the screening room…</p>}
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
