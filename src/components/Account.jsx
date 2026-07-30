import React, { useState, useEffect } from "react";
import { store } from "../lib/store.js";
import { ADMIN_EMAIL, cloud } from "../lib/supabaseClient.js";
import { C } from "../lib/constants.js";
import { SectionHead, Panel, Stat } from "./Shared.jsx";
import { trackSignupConversion } from "../lib/googleAds.js";

// ---------------- Admin analytics — visible only to ADMIN_EMAIL ----------------
export function AdminPage() {
  const [stats, setStats] = useState(null);
  const [members, setMembers] = useState(null);
  const [vetoStats, setVetoStats] = useState(null);
  const [eventStats, setEventStats] = useState(null);
  const [newUserStats, setNewUserStats] = useState(null);

  useEffect(() => {
    if (!cloud.enabled()) return;
    let on = true;
    (async () => {
      const [visits, visits7, visits30, accounts, lobby, chats, recent, vetoes, events, newUsers] = await Promise.all([
        cloud.getPageviewCount(),
        cloud.getPageviewsSince(7),
        cloud.getPageviewsSince(30),
        cloud.getMemberCount(),
        cloud.getLobbyStats(),
        cloud.getChatCount(),
        cloud.recentMembers(8),
        cloud.getVetoStats(),
        cloud.getEventStats(),
        cloud.getNewUserPickerStats(),
      ]);
      if (!on) return;
      setStats({ visits, visits7, visits30, accounts, lobby, chats });
      setMembers(recent);
      setVetoStats(vetoes);
      setEventStats(events);
      setNewUserStats(newUsers);
    })();
    return () => { on = false; };
  }, []);

  const v = (x) => x == null ? "—" : x;

  return (
    <div className="nol-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 40px" }}>
      <SectionHead kicker="Just for you" title="Analytics"
        sub="A quiet look at how REELmunity is doing. Visible only to your account." />

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

          {newUserStats && newUserStats.total > 0 && (
            <Panel title="New users trying the picker">
              <p style={{ color: C.faint, fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
                Counted once per browser or account, the very first time they ever spin —
                a real signal of new people actually trying the core feature, not just visiting.
              </p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <Stat label="All time" value={v(newUserStats.total)} accent={C.amber} />
                <Stat label="Last 7 days" value={v(newUserStats.last7)} />
                <Stat label="Last 30 days" value={v(newUserStats.last30)} accent={C.green} />
              </div>
            </Panel>
          )}

          {vetoStats && vetoStats.total > 0 && (
            <Panel title="Veto usage per commit" right={`${vetoStats.total} nights tracked`}>
              <p style={{ color: C.faint, fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
                How many vetoes people burn before committing to a pick — useful for deciding
                whether 2 vetoes is already enough, or people are running out and settling.
              </p>
              {[0, 1, 2].map(n => {
                const count = vetoStats[n] || 0;
                const pct = Math.round((count / vetoStats.total) * 100);
                return (
                  <div key={n} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 4 }}>
                      <span>{n} veto{n === 1 ? "" : "es"} used</span>
                      <span>{pct}% ({count})</span>
                    </div>
                    <div style={{ height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: n === 2 ? C.red : n === 1 ? C.amber : C.green }} />
                    </div>
                  </div>
                );
              })}
              <p style={{ color: C.faint, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
                A high share of "2 vetoes used" (red) suggests people are hitting the ceiling and
                might benefit from a 3rd veto. Mostly "0 used" (green) suggests 2 is already generous.
              </p>
            </Panel>
          )}

          {eventStats && eventStats.spinCount > 0 && (
            <Panel title="Spin-to-commit ratio" right={`${eventStats.spinCount} spins tracked`}>
              <p style={{ color: C.faint, fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
                How often a spin actually turns into a commit — a low ratio can mean people are
                re-spinning past the veto system entirely rather than formally vetoing.
              </p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <Stat label="Spins" value={eventStats.spinCount} />
                <Stat label="Commits" value={eventStats.commitCount} accent={C.amber} />
                <Stat label="Commit rate" value={`${Math.round((eventStats.commitCount / eventStats.spinCount) * 100)}%`} accent={C.green} />
              </div>
            </Panel>
          )}

          {eventStats && eventStats.commitCount > 0 && (
            <Panel title="Which picker source gets used">
              <p style={{ color: C.faint, fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
                Based on commits, not just spins — shows what people actually settle on.
              </p>
              {[["taste", "Match my taste"], ["trending", "Trending now"], ["watchlist", "My watchlist"], ["rewatch", "Rewatch night"]].map(([key, label]) => {
                const count = eventStats.commitsBySource[key] || 0;
                const pct = Math.round((count / eventStats.commitCount) * 100);
                return (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 4 }}>
                      <span>{label}</span>
                      <span>{pct}% ({count})</span>
                    </div>
                    <div style={{ height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: C.amber }} />
                    </div>
                  </div>
                );
              })}
            </Panel>
          )}

          {eventStats && eventStats.commitCount > 0 && (
            <Panel title="Movie night completion" right={`${eventStats.commitCount} commits tracked`}>
              <p style={{ color: C.faint, fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
                Of everyone who committed to a pick, how many came back and actually finished rating it.
              </p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <Stat label="Committed" value={eventStats.commitCount} />
                <Stat label="Rated after" value={eventStats.ratingCount} accent={C.green} />
                <Stat label="Completion" value={`${Math.round((eventStats.ratingCount / eventStats.commitCount) * 100)}%`} accent={C.amber} />
              </div>
            </Panel>
          )}

          {eventStats && eventStats.theaterActionCount > 0 && (
            <Panel title="In Theaters engagement" right={`${eventStats.theaterActionCount} clicks tracked`}>
              <p style={{ color: C.faint, fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
                Which of the three (or four) options people actually reach for.
              </p>
              {[["overview", "Overview"], ["trailer", "Trailer"], ["tickets", "Buy Tickets"], ["release", "Release Date"]].map(([key, label]) => {
                const count = eventStats.byAction[key] || 0;
                const pct = Math.round((count / eventStats.theaterActionCount) * 100);
                if (count === 0) return null;
                return (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 4 }}>
                      <span>{label}</span>
                      <span>{pct}% ({count})</span>
                    </div>
                    <div style={{ height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: C.red }} />
                    </div>
                  </div>
                );
              })}
            </Panel>
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
export function ResetPasswordPage({ onDone }) {
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
          <button className="nol-btn big" onClick={onDone}>Continue to REELmunity</button>
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

export function AccountPage({ user, onDone, initialMode, handle, saveHandle }) {
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
          sub="This copy of REELmunity is running in local mode — everything saves to this browser only." />
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
            to any device you sign in on. Screening room posts are shared with all REELmunity users. You'll stay
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
          trackSignupConversion();
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
        sub="Sync your Rating List across devices and join The Lobby." />
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
