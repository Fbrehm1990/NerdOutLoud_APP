# NerdOutLoud — Turning on Accounts (one-time setup, ~10 minutes, free)

Accounts give your users: sign up / sign in, their board and library synced across
devices, and film lobbies that are genuinely shared between all users.

Until you complete these steps, the site runs in local mode (everything saves per-browser).

## Step 1 — Create a Supabase project
1. Go to https://supabase.com and sign up (free).
2. Click "New project". Name it `nerdoutloud`, set a database password (save it somewhere), pick the region closest to your users, and create it.

## Step 2 — Create the database tables
1. In your project, open **SQL Editor** (left sidebar) and click "New query".
2. Paste ALL of the SQL below and click **Run**:

```sql
-- Per-user app state (board, library, ratings, settings)
create table public.nol_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.nol_states enable row level security;

create policy "own state select" on public.nol_states
  for select using (auth.uid() = user_id);
create policy "own state insert" on public.nol_states
  for insert with check (auth.uid() = user_id);
create policy "own state update" on public.nol_states
  for update using (auth.uid() = user_id);

-- Shared film lobbies (comments)
create table public.nol_lobby (
  id bigint generated always as identity primary key,
  film_slug text not null,
  handle text not null,
  body text,
  rating numeric,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index nol_lobby_slug_idx on public.nol_lobby (film_slug, created_at);
alter table public.nol_lobby enable row level security;

create policy "lobby read for everyone" on public.nol_lobby
  for select using (true);
create policy "lobby post when signed in" on public.nol_lobby
  for insert with check (auth.uid() = user_id);
```

## Step 3 — Configure authentication
1. Go to **Authentication → Providers** and make sure **Email** is enabled (it is by default).
2. Optional but recommended while testing: **Authentication → Providers → Email → turn OFF
   "Confirm email"** so new users can sign in immediately. Turn it back on for production.

## Step 4 — Get your keys
1. Go to **Project Settings → API**.
2. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`).
3. Copy the **anon public** key (long string). This key is designed to be public —
   your data is protected by the row-level security policies you created in Step 2.
   NEVER use the `service_role` key in the website.

## Step 5 — Paste the keys into the site
1. Open `index.html` in any text editor.
2. Find these two lines near the top of the script:
   ```
   const SUPABASE_URL = "";
   const SUPABASE_ANON_KEY = "";
   ```
3. Paste your values between the quotes.
4. Save, and re-deploy the file to Netlify (drag the folder/zip onto app.netlify.com/drop).

## Step 6 — Test
1. Open your site, menu → "Sign in" → Create account.
2. Rate a movie, then open the site in a different browser or your phone, sign in,
   and confirm your board followed you.
3. Post in a film's lobby from two different accounts and confirm both posts appear.

## Notes
- Free tier limits (generous for a hobby app): 50,000 monthly active users, 500 MB database.
- Once accounts are live, your Privacy Policy needs updating — it currently says no data
  is stored on servers. Update sections 1, 2, and 6 to reflect account storage in Supabase,
  and have a lawyer review before any commercial use.

## Update — Community board (threaded replies)

The board's lobbies now support replying to other users' comments, which needs one
new column. Run this once in Supabase's SQL Editor (safe to run even if you've
already run the setup above):

```sql
alter table public.nol_lobby
  add column if not exists parent_id bigint references public.nol_lobby (id) on delete cascade;
create index if not exists nol_lobby_parent_idx on public.nol_lobby (parent_id);
```

That's it — no changes to policies or your keys needed.

## Update — Reactions & spoiler tags

The community board's emoji reactions and spoiler tags need two new columns, plus a
safety trigger. The trigger matters: without it, the update permission reactions
need would technically let any signed-in user rewrite the *text* of someone else's
comment via a raw API call. The trigger locks that down — only the reactions and
spoiler flag can ever change after a comment is posted; everything else throws an
error if touched. Run this once in the SQL Editor:

```sql
alter table public.nol_lobby
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists spoiler boolean not null default false;

drop policy if exists "lobby reactions update" on public.nol_lobby;
create policy "lobby reactions update" on public.nol_lobby
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

create or replace function public.nol_lobby_protect_columns()
returns trigger as $$
begin
  if new.body is distinct from old.body
     or new.rating is distinct from old.rating
     or new.handle is distinct from old.handle
     or new.user_id is distinct from old.user_id
     or new.film_slug is distinct from old.film_slug
     or new.parent_id is distinct from old.parent_id then
    raise exception 'Only reactions and the spoiler flag can be updated after posting';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists nol_lobby_protect on public.nol_lobby;
create trigger nol_lobby_protect
  before update on public.nol_lobby
  for each row execute function public.nol_lobby_protect_columns();
```

## Update — Edit & delete your own comments

You can now edit or delete any comment or reply you posted. This needs a delete
policy and a smarter version of the protective trigger from the reactions update —
the old trigger blocked everyone from editing comment text, including the owner.
This version allows the owner to edit their own body/rating/spoiler flag, while
still restricting everyone else to reactions only. Run this once in the SQL Editor
(it fully replaces the previous trigger, so no need to remove the old one first):

```sql
drop policy if exists "lobby delete own" on public.nol_lobby;
create policy "lobby delete own" on public.nol_lobby
  for delete using (auth.uid() = user_id);

create or replace function public.nol_lobby_protect_columns()
returns trigger as $$
begin
  if auth.uid() is distinct from old.user_id then
    -- Not the owner: only reactions may change (this is how the reaction buttons work)
    if new.body is distinct from old.body
       or new.rating is distinct from old.rating
       or new.spoiler is distinct from old.spoiler
       or new.handle is distinct from old.handle
       or new.user_id is distinct from old.user_id
       or new.film_slug is distinct from old.film_slug
       or new.parent_id is distinct from old.parent_id then
      raise exception 'Only the comment owner can edit this; others may only react';
    end if;
  else
    -- The owner: may edit body/rating/spoiler, but can't reassign who posted it or where it lives
    if new.handle is distinct from old.handle
       or new.user_id is distinct from old.user_id
       or new.film_slug is distinct from old.film_slug
       or new.parent_id is distinct from old.parent_id then
      raise exception 'Cannot change who posted a comment or where it belongs';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists nol_lobby_protect on public.nol_lobby;
create trigger nol_lobby_protect
  before update on public.nol_lobby
  for each row execute function public.nol_lobby_protect_columns();
```

Note: deleting a top-level comment also deletes its replies, since replies
reference it with `on delete cascade` from the original setup.

## Update — Notifications

A notification bell now appears next to the menu once accounts are on. It shows:
replies to your comments, new comments/ratings on films you've rated or watched,
and quiet digests like "3 new movies added to Trending" or "New on Netflix: 5
titles just added." It updates live while the site is open, using Supabase's
Realtime feature — no SQL needed, but Realtime must be turned on for the table:

**Option A — dashboard:** go to **Database → Publications** in the left sidebar
(this section is sometimes called "Replication" in older Supabase UI versions).
Click into `supabase_realtime` and toggle **on** the switch next to `nol_lobby`.

**Option B — one line of SQL** (faster, and works regardless of UI version).
Run this once in the SQL Editor:

```sql
alter publication supabase_realtime add table public.nol_lobby;
```

**Honest limitation:** this is an in-app notification bell, live while the site
is open in a browser tab. It is not an OS-level push notification that can reach
a phone's lock screen or alert someone after they've closed the site — that
would need a service worker, push subscriptions, and a small server to dispatch
them, which is a separate, larger project if you want to take it that far later.

## Update — Welcome spotlight

The home page now shows a "Welcome to the family" strip of the newest patrons,
updating live as people join, plus a notification when someone new signs up.
This needs one new table. Run this once in the SQL Editor:

```sql
create table if not exists public.nol_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  joined_at timestamptz not null default now()
);
alter table public.nol_members enable row level security;

drop policy if exists "members read for everyone" on public.nol_members;
create policy "members read for everyone" on public.nol_members
  for select using (true);

drop policy if exists "members insert own" on public.nol_members;
create policy "members insert own" on public.nol_members
  for insert with check (auth.uid() = user_id);

drop policy if exists "members update own handle" on public.nol_members;
create policy "members update own handle" on public.nol_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.nol_members;
```

This table stores only a patron's chosen display name and when they joined —
nothing else. It stays in sync automatically: it's written once at signup and
again anytime someone updates their patron name from the Account page.

## Update — Patron Chatbox

A floating chat bubble now appears on the home page (bottom-right) — a general,
real-time chat room for patrons to talk about anything movie-related, separate
from the film-specific lobbies on the board. Needs one new table. Run this once
in the SQL Editor:

```sql
create table if not exists public.nol_chat (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  handle text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists nol_chat_created_idx on public.nol_chat (created_at);
alter table public.nol_chat enable row level security;

drop policy if exists "chat read for everyone" on public.nol_chat;
create policy "chat read for everyone" on public.nol_chat
  for select using (true);

drop policy if exists "chat post when signed in" on public.nol_chat;
create policy "chat post when signed in" on public.nol_chat
  for insert with check (auth.uid() = user_id);

drop policy if exists "chat delete own" on public.nol_chat;
create policy "chat delete own" on public.nol_chat
  for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.nol_chat;
```

Anyone can read the chat (even signed-out visitors, to preview the community),
but only signed-in patrons can post, and only the person who posted a message
can delete it. Messages are capped at 300 characters — kept short and casual on
purpose, since this is a chatroom, not a review space.

## Update — Community Top Rated (average of everyone's ratings)

The board now shows a "Community top rated" strip — films ranked by the average
of every patron's rating, not any one person's. Since each patron's own data is
private to their account, this needs a small shared catalog (just name, year,
director, and poster art — populated automatically the first time anyone rates
a film) plus a view that averages ratings across all patrons. Run this once in
the SQL Editor:

```sql
create table if not exists public.nol_films (
  slug text primary key,
  name text not null,
  year int,
  director text,
  poster text,
  updated_at timestamptz not null default now()
);
alter table public.nol_films enable row level security;

drop policy if exists "films read for everyone" on public.nol_films;
create policy "films read for everyone" on public.nol_films
  for select using (true);

drop policy if exists "films upsert when signed in" on public.nol_films;
create policy "films upsert when signed in" on public.nol_films
  for insert with check (auth.uid() is not null);

drop policy if exists "films update when signed in" on public.nol_films;
create policy "films update when signed in" on public.nol_films
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

create or replace view public.nol_community_ratings
with (security_invoker = true) as
select f.slug, f.name, f.year, f.director, f.poster,
       avg(l.rating)::numeric(4,2) as avg_rating,
       count(l.rating) as rating_count
from public.nol_lobby l
join public.nol_films f on f.slug = l.film_slug
where l.rating is not null
group by f.slug, f.name, f.year, f.director, f.poster;

grant select on public.nol_community_ratings to anon, authenticated;
```

The `security_invoker = true` option makes the view respect the same row-level
security as the underlying tables, so it stays consistent with everything else.
No Realtime toggle needed for this one — the strip refreshes each time the board
loads, which is the right cadence for an averaged list like this.

## Update — Bigger per-service movie pool (up to 1,000 titles)

The picker's per-service pool was raised from 200 to a ceiling of about 1,000
titles per streaming service, and page fetches now run in parallel batches
instead of one at a time, so the larger pull doesn't take noticeably longer to
load than before.

Why not truly unlimited: TMDB itself caps any single query at 500 pages
regardless of how large the real catalog is, and a service like Netflix's full
US catalog can run into the thousands of titles. Pulling genuinely everything
would mean a much slower first load and a meaningfully larger amount of data
sitting in the visitor's browser storage just for movie lists. 1,000 titles per
service (refreshed once a day, cached after that) covers the large majority of
anything a person would realistically search for, while staying fast.

## Update — Private analytics dashboard (visits, accounts, comments, ratings)

This adds a simple "Analytics" page, visible only in your own account's menu,
showing total site visits, accounts created, comments, ratings, reactions, and
chat messages.

**Important — read before running:** the SQL below restricts who can read the
visit-count data to exactly one email address at the database level. Replace
`YOUR_EMAIL_HERE@example.com` in the SQL with the actual email you sign in
with — this must be the same email you set in the `ADMIN_EMAIL` constant near
the top of `index.html`. If the two don't match exactly (case doesn't matter,
but spelling does), the dashboard will stay invisible to everyone, including
you.

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
  for select using (auth.jwt() ->> 'email' = 'YOUR_EMAIL_HERE@example.com');
```

**Then in `index.html`**, find this line near the top of the script and fill
in the same email:

```
const ADMIN_EMAIL = "";
```

becomes, for example:

```
const ADMIN_EMAIL = "you@example.com";
```

**Two honest limits worth understanding:**

1. **Visit counts are genuinely private** — enforced by the database itself,
   not just hidden in the app. Nobody but your account can read that table,
   even with the anon key and developer tools.
2. **Comment, rating, reaction, and chat counts are not the same kind of
   private.** They're computed from `nol_lobby` and `nol_chat`, which have to
   stay publicly readable for the app itself to work — every patron needs to
   read lobby comments and chat to use those features. A technically capable
   visitor could compute the same totals themselves by querying those tables
   directly; the dashboard just does the counting for you conveniently. This
   isn't a flaw to fix — it's an inherent property of a public community
   feature — just worth knowing which numbers are truly locked and which
   aren't.

The comment/rating/reaction counts sample the most recent 5,000 lobby posts
for performance — a note appears on the dashboard if that cap is ever reached.
