import React, { useState, useEffect } from "react";
import { ADMIN_EMAIL, cloud } from "../lib/supabaseClient.js";
import { C } from "../lib/constants.js";
import { calStats } from "../lib/utils.js";

export function Popcorn({ flip, size, uid }) {
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

export function PopcornPair({ flip, uid }) {
  return (
    <div className="nol-popcorn-wrap" style={{ flexDirection: flip ? "row-reverse" : "row" }}>
      <Popcorn uid={`${uid}-back`} flip={flip} size={66} />
      <div style={{ margin: flip ? "0 -20px 0 0" : "0 0 0 -20px", zIndex: 1 }}>
        <Popcorn uid={`${uid}-front`} flip={flip} size={96} />
      </div>
    </div>
  );
}

export function FilmStrip() {
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

export function HowItWorks() {
  const steps = [
    ["🎬", "Spin", "One tap picks your movie from what's actually on your services."],
    ["⭐", "Rate", "Call your rating before you watch, then settle the real score after."],
    ["💬", "Talk", "Land in The Lobby — see what everyone else rated it, and say your piece."],
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

export function TopBar({ goHome, openMenu, nightActive, unreadCount, onOpenNotifs }) {
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
          <span style={{ color: C.amber }}>REEL</span>
          <span style={{ fontFamily: "'Karla', sans-serif", fontSize: "0.62em", fontWeight: 700, letterSpacing: "0.02em" }}>munity</span>
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

export function NotifPanel({ open, close, notifications, onClickNotif, onDismiss, onMarkAllRead, onClearAll }) {
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
          <div style={{ display: "flex", gap: 12 }}>
            {notifications.some(n => !n.read) && (
              <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={onMarkAllRead}>Mark all read</span>
            )}
            {notifications.length > 0 && (
              <span className="nol-danger-link" style={{ fontSize: 12 }} onClick={onClearAll}>Clear all</span>
            )}
          </div>
        </div>
        {notifications.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 13, padding: "20px 18px", margin: 0, textAlign: "center" }}>
            Nothing yet — new comments, replies, and movie drops will show up here.
          </p>
        ) : (
          notifications.map((n, i) => (
            <div key={n.id} className="nol-row" style={{
              display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 18px",
              borderBottom: i < notifications.length - 1 ? `1px solid ${C.edge}` : "none",
              background: n.read ? "transparent" : "rgba(255,182,39,0.05)",
            }}>
              <div onClick={() => onClickNotif(n)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  {!n.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, fontWeight: 700, color: n.read ? C.muted : C.text, lineHeight: 1.4 }}>{n.title}</span>
                </div>
                {n.sub && <div style={{ color: C.faint, fontSize: 12.5, marginTop: 3, marginLeft: n.read ? 0 : 14, lineHeight: 1.5 }}>{n.sub}</div>}
                <div style={{ color: C.faint, fontSize: 11, marginTop: 4, marginLeft: n.read ? 0 : 14 }}>
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

export function Menu({ open, close, go, view, nightActive, state, user }) {
  if (!open) return null;
  const { calibration } = calStats(state);
  const honor = state.spins.committed ? `${Math.round(100 * state.spins.honored / state.spins.committed)}%` : "—";
  const gated = cloud.enabled() && !user;
  const isAdmin = !!(ADMIN_EMAIL && user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  const items = [
    ["home", "Tonight's pick", nightActive ? "Movie night in progress" : "Spin, call it, watch, rate — all in one"],
    ["theaters", "In Theaters", "Everything playing now and coming soon — overview, trailer, tickets"],
    ["board", gated ? "The Lobby — locked" : "The Lobby", gated ? "Create a free account to unlock the community and film discussions" : "Talk movies with other patrons — rate, review, discuss"],
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

export function Marquee() {
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
          <span style={{ color: C.amber, textShadow: `0 0 24px rgba(255,182,39,0.6)` }}>REEL</span>
          <span style={{ fontFamily: "'Karla', sans-serif", fontSize: "0.6em", fontWeight: 700, letterSpacing: "0.02em", textShadow: "none" }}>munity</span>
        </h1>
        <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", textAlign: "center", whiteSpace: "nowrap" }}>
          Stop scrolling · Start watching
        </p>
        <p style={{
          margin: "10px 0 0", color: C.text, fontSize: 15, fontWeight: 700,
          textAlign: "center", maxWidth: 400, marginLeft: "auto", marginRight: "auto", lineHeight: 1.3,
        }}>
          Stuck scrolling? Let us pick for you, fast and easy!
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

export function SectionHead({ kicker, title, sub }) {
  return (
    <div style={{ textAlign: "center", margin: "26px 0 24px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.35em", textTransform: "uppercase", color: C.amber, marginBottom: 6 }}>— {kicker} —</div>
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(30px, 8vw, 38px)", letterSpacing: "0.08em", margin: 0, color: C.text }}>{title}</h2>
      {sub && <p style={{ color: C.muted, fontSize: 14, maxWidth: 480, margin: "10px auto 0", lineHeight: 1.55 }}>{sub}</p>}
    </div>
  );
}

export function Panel({ title, right, children }) {
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

export function Stat({ label, value, accent }) {
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

export function RatingSlider({ value, onChange, color }) {
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
export function DualRangeSlider({ min, max, step, lo, hi, onChange, disabled }) {
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

export function TicketStub({ film, onPick, corner, tag }) {
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
export function Avatar({ name, size }) {
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

export const REACTIONS = ["🔥", "😂", "💯", "😢", "🍿"];

// ---------------- Film screening room: talk about the movie ----------------
