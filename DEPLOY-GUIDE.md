# REELmunity — Production Deploy Guide

This is a real Vite + React production build — React, ReactDOM, and Supabase
are bundled locally (no CDN dependency), Babel is gone entirely (JSX is
compiled once at build time, not in every visitor's browser), and TMDB calls
now route through a serverless proxy so the API key never ships to the client.

## What changed from the old single-file version

- **No more CDN scripts, no more Babel-in-the-browser.** Everything is a real
  npm dependency, bundled and minified by Vite. Old page weight was roughly
  1.85 MB (mostly Babel Standalone) plus JSX compile time on every visit.
  New page weight is **138.76 KB gzipped total** — React, ReactDOM,
  Supabase-js, and your entire app, pre-compiled.
- **TMDB's API key is no longer in your page's source.** It lives only on
  the server now, in a Netlify Function (`netlify/functions/tmdb.js`), read
  from an environment variable.
- **Your deploy method has to change.** Serverless functions don't work with
  dragging a zip onto app.netlify.com/drop — that only handles static files.
  You need either a GitHub-connected Netlify site (recommended, and what
  these instructions assume) or the Netlify CLI.

## One-time setup

### 1. Install Node.js if you don't have it
Download from nodejs.org (any current LTS version works).

### 2. Get the project running locally (optional, but good to confirm first)
```
npm install
npm run dev
```
Note: the TMDB proxy function won't work with plain `npm run dev` — that's
expected, functions only run under Netlify's own dev server or once deployed.
To test the proxy locally, install the Netlify CLI (`npm install -g netlify-cli`)
and run `netlify dev` instead.

### 3. Push this project to GitHub
```
git init
git add .
git commit -m "REELmunity production build"
```
Create a new repository on github.com, then follow GitHub's instructions to
push (`git remote add origin ...`, `git push -u origin main`).

### 4. Connect the repo to Netlify
In your Netlify dashboard: **Add new site → Import an existing project →
Deploy with GitHub**, pick this repository. Netlify will auto-detect the
build settings from `netlify.toml` (build command `npm run build`, publish
directory `dist`, functions directory `netlify/functions`) — you shouldn't
need to change anything.

### 5. Set your TMDB key as an environment variable
In Netlify: **Site configuration → Environment variables → Add a variable**.
- Key: `TMDB_KEY`
- Value: `378dfb29e72275926d9bfe3bb110678f` (the key you already had)

This is the whole point of the proxy — the key lives here, server-side, and
is never sent to anyone's browser.

### 6. Deploy
Netlify builds and deploys automatically once connected. Future updates: just
`git push` — Netlify rebuilds and redeploys on its own.

## Supabase — nothing changes here

All your existing Supabase tables, RLS policies, and Realtime settings from
earlier stay exactly as they were — this migration only changed how the
frontend is built and how TMDB is called, not your database. If you haven't
already run every SQL block from your earlier setup notes, do that first.

### New — analytics dashboard is now configured for you
`ADMIN_EMAIL` is set to `cyber1patriot@gmail.com` in the code already. Run
this in Supabase's SQL Editor if you haven't yet (same as before, just with
your email filled in):

```sql
create table if not exists public.nol_pageviews (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  path text
);
alter table public.nol_pageviews enable row level security;

drop policy if exists "pageviews insert for everyone" on public.nol_pageviews;
create policy "pageviews insert for everyone" on public.nol_pageviews
  for insert with check (true);

drop policy if exists "pageviews select admin only" on public.nol_pageviews;
create policy "pageviews select admin only" on public.nol_pageviews
  for select using (auth.jwt() ->> 'email' = 'cyber1patriot@gmail.com');
```

Sign in with that email once deployed and "Analytics" will appear in your
menu.

## Analytics services — Google Analytics, Search Console, Microsoft Clarity

All three are wired into `index.html` with clear placeholder comments —
search for `PASTE_YOUR` / `G-XXXXXXXXXX` / `YOUR_CLARITY_ID` in that file.

- **Google Analytics (GA4):** create a property at analytics.google.com,
  find your Measurement ID (Admin → Data Streams → your web stream — looks
  like `G-XXXXXXXXXX`), replace it in **both** places it appears in
  `index.html`.
- **Google Search Console:** go to search.google.com/search-console, add
  your property, choose the "HTML tag" verification method, copy the
  `content="..."` value it gives you, paste it into the
  `google-site-verification` meta tag already in `index.html`.
- **Microsoft Clarity:** create a project at clarity.microsoft.com, copy
  your Project ID from the setup instructions, replace `YOUR_CLARITY_ID`
  in `index.html`.

None of these need a rebuild step beyond a normal `git push` — just edit,
commit, push.

## What I verified vs. what still needs a live check

**Verified:** the production build compiles cleanly with no errors, the
bundle is correctly minified and tree-shaken, and the built site serves
correctly as static files.

**Needs a live check after you deploy:** my sandbox can't reach Supabase or
TMDB's servers (same limitation I've had throughout this whole build), so I
can't click through a live spin, a real sign-in, or a Nerdmunity post from
here. After deploying, please run through: spin a movie → commit → rate it →
check it lands correctly on Nerdmunity and your Library. If anything looks
off, tell me exactly what you see and I'll debug it with you the same way
we've done all along.

## Environment variables (optional)

Supabase config and the admin email can be set via environment variables
instead of being hardcoded — see `.env.example` for the full list and what
each one does. All three are optional; the app falls back to the current
live project's values if left unset, so this is a safe, non-breaking option,
not a required migration step.

To use a different Supabase project (e.g., a staging environment):
1. Copy `.env.example` to `.env` for local development (already gitignored).
2. For production, set the same variable names in Netlify's dashboard:
   **Site configuration → Environment variables**.
3. Trigger a fresh deploy — Vite reads these at *build* time, so a change
   here requires a new build to take effect, same as any other env var.

`TMDB_KEY` and `OMDB_KEY` are unaffected by this — they were already
server-only, set directly in Netlify without a `VITE_` prefix, and read only
by the Netlify Functions, never by the browser-side app.
