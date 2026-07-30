# REELmunity

A movie-picker web app at [reelmunity.com](https://reelmunity.com). Spin once,
call your rating before you watch, then talk it out with the crew in The Lobby.

## What this actually does

- **The Picker** — spins across your streaming services (live TMDB data), what's
  trending, your watchlist, or a rewatch night. Filters by genre, runtime,
  release-year range, and content rating.
- **Prediction & calibration** — lock in a rating before you watch, rate it
  again after, and track how well your gut call matches your honest reaction
  over time.
- **In Theaters** — trending titles still playing in theaters (or coming soon)
  get their own overview/trailer/tickets breakdown, separated from streaming
  picks using TMDB's actual per-country release-type data, not a guess.
- **The Lobby** — a live discussion thread per film: ratings, replies,
  reactions, spoiler tags, a community average alongside your own score.
- **Library** — your watchlist and rated films, searchable by title or actor.
- **Accounts** — optional. The app works entirely local-first with no account;
  signing in (via Supabase) syncs your data across devices and unlocks The Lobby.

## Architecture

```
src/
  lib/
    store.js            Portable storage shim (Claude window.storage locally,
                         browser localStorage when deployed)
    supabaseClient.js    Supabase client + all cloud read/write functions
    tmdb.js              TMDB + OMDb API clients, all data-mapping helpers
    constants.js          Colors, moods, seed data, fallback catalog
    utils.js              Pure business logic: slugify, calibration scoring,
                          streak tracking, taste profiling, weighted picking
    errorMonitoring.js    Sentry init — no-ops unless VITE_SENTRY_DSN is set
  components/
    Shared.jsx            Small presentational pieces + nav chrome (TopBar,
                          Menu, NotifPanel, Marquee, etc.)
    Picker.jsx             The spin mechanic — the app's core screen
    NightFlow.jsx          Guided prerate -> watch -> rate flow
    Lobby.jsx               Per-film discussion thread
    BoardPage.jsx           The Lobby's film list + search
    TheaterFeatures.jsx     Trending strip, theatrical modals (Overview/
                            Trailer/Tickets/Release Date), shared by both
                            Picker and TheatersPage
    TheatersPage.jsx        The dedicated /theaters browse page
    CommunityFeatures.jsx   Welcome spotlight, live Patron Board chat
    Library.jsx              Watchlist/rated list + every-movie search
    Account.jsx               Sign in/up, password reset, admin analytics
    GatePage.jsx               "create an account" prompt (kept separate from
                               Account.jsx so it isn't lazy-loaded — see below)
    LegalPage.jsx               Terms, Privacy, Accessibility
    ErrorBoundary.jsx            Catches render-time crashes, reports to Sentry
  styles/globalStyles.js   The single injected <style> block
  App.jsx                    Routing + top-level state
  main.jsx                    Entry point — wraps App in ErrorBoundary,
                              initializes error monitoring
test/
  utils.test.js             Calibration, streak, taste-profile, weighted-pick
  tmdb.test.js               TMDB data-mapping functions
netlify/functions/
  tmdb.js, omdb.js           Server-side proxies — API keys never reach the
                             browser (see Environment variables below)
```

**Why the file split looks the way it does:** route-gated screens (Account,
Library, BoardPage, TheatersPage, LegalPage, NightFlow) are lazy-loaded via
`React.lazy` in `App.jsx`, so a first-time visitor's initial bundle doesn't
include code for pages they haven't navigated to yet. `GatePage` was
deliberately pulled out of `Account.jsx` into its own file — it's shown
fairly often (anyone gated from The Lobby or Library sees it), and if it had
stayed in the same file as the heavier admin/account components, importing
it would have pulled all of that in eagerly too, defeating the point of
lazy-loading `Account.jsx` at all. Similarly, `TheatersPage.jsx` is separate
from `TheaterFeatures.jsx` — the trending strip and modals in
`TheaterFeatures.jsx` are needed immediately on the home page (via `Picker`),
while the full theaters browse page is only needed after navigating there.

## Environment variables

All optional — every one has a working fallback to the current live values,
so a fresh clone with zero configuration still runs. See `.env.example` for
the full list with explanations. Briefly:

| Variable | What it's for | Required? |
|---|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL | No — falls back to the live project |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key (safe to expose) | No — same fallback |
| `VITE_ADMIN_EMAIL` | Who can see the Analytics dashboard | No — same fallback |
| `VITE_SENTRY_DSN` | Turns on production error monitoring | No — no-ops entirely if unset |
| `TMDB_KEY` | TMDB API key | **Yes, for movie data to work** |
| `OMDB_KEY` | OMDb API key (Rotten Tomatoes/IMDb/Metacritic) | **Yes, for critic scores** |

`TMDB_KEY` and `OMDB_KEY` are the two that actually matter to set: they're
real secrets, deliberately **not** prefixed with `VITE_` (that prefix tells
Vite to bake a value into the public bundle — exactly what you don't want for
these two). They're read only by the Netlify Functions in
`netlify/functions/`, never by browser-side code. Set them directly in
Netlify's dashboard under Site configuration → Environment variables.

## Local development

```bash
npm install
cp .env.example .env    # optional — only needed to point at a different
                         # Supabase project or turn on Sentry locally
npm run dev
```

## Testing

```bash
npm test          # runs once
npm run test:watch # watch mode
```

37 tests covering the pure business-logic functions in `lib/utils.js` and
`lib/tmdb.js` — calibration scoring, streak tracking (including the
"yesterday still counts" grace-period edge case), taste profiling, weighted
random picking, and TMDB's genre/service/film data mapping. These are
deliberately the highest-value, easiest-to-regress pieces of logic in the
app — the kind of thing that's easy to break silently in a future edit
without a test catching it.

## Building

```bash
npm run build     # outputs to dist/
npm run preview   # serves the production build locally
```

The build is code-split: route-gated pages (Account, Library, BoardPage,
TheatersPage, LegalPage, NightFlow) load as separate chunks on demand rather
than bloating the initial bundle. Check the build output for current chunk
sizes.

## Deployment

Deployed via Netlify, connected directly to this GitHub repo — every push to
`main` triggers a build and deploy automatically. See `DEPLOY-GUIDE.md` for
the full walkthrough, including the Supabase SQL migrations required for
accounts/community features to work, and how to set up error monitoring.

**Netlify build settings:**
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

## A note on `node_modules` and git

`node_modules` should never be committed — it's in `.gitignore`. If you ever
see build failures on Netlify that don't reproduce locally (particularly
`Permission denied` errors on a binary like `vite`), the first thing to check
is `git ls-files | grep node_modules` — if that returns anything, someone
accidentally committed it at some point (easy to do from Windows, since
Windows doesn't track Unix executable permissions the way Linux does, and a
binary that loses its executable bit in a Windows-committed copy will fail
silently on Netlify's Linux build servers no matter how many times you clear
the build cache). Fix: `git rm -r --cached node_modules` and commit.
