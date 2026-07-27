// ---------- Portable storage: uses Claude's window.storage when present,
// ---------- falls back to browser localStorage when deployed to the web.
// ---------- "Shared" keys power the film lobbies: shared across users in
// ---------- Claude artifacts; per-browser on a static deploy (until a backend).
export const store = {
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

