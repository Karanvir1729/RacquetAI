-- RacquetIQ platform schema (Supabase project: olljogfjesovpfjxraxf)
-- Idempotent: safe to re-run in the SQL editor.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: own row read" on public.profiles;
create policy "profiles: own row read"
  on public.profiles for select
  using (auth.uid () = id);

drop policy if exists "profiles: own row update" on public.profiles;
create policy "profiles: own row update"
  on public.profiles for update
  using (auth.uid () = id)
  with check (auth.uid () = id);

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

-- ---------------------------------------------------------------------------
-- app_events: metrics event stream from web + iOS clients and the server
-- ---------------------------------------------------------------------------
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  event text not null,
  platform text not null default 'web', -- 'web' | 'ios' | 'server'
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_created_at_idx on public.app_events (created_at);
create index if not exists app_events_event_idx on public.app_events (event);

alter table public.app_events enable row level security;

-- Anyone with the publishable key may write events (signed-in rows must be
-- their own); nobody but service role may read them back.
drop policy if exists "app_events: client insert" on public.app_events;
create policy "app_events: client insert"
  on public.app_events for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid ());

-- ---------------------------------------------------------------------------
-- waitlist: early-access signups from the public site
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  -- Stored normalized (client lowercases + trims before insert; the check
  -- keeps a bypassing client from smuggling in a case-variant duplicate).
  email text not null unique
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    ),
  club text check (char_length(club) <= 120),
  source text not null default 'web',
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Anyone with the publishable key may join (the form works signed-out); only
-- the service role may read the list back. No select policy also means
-- `on conflict` upserts are rejected by RLS, so the client does a plain
-- insert and treats unique-violation 23505 as "already on the list".
drop policy if exists "waitlist: client insert" on public.waitlist;
create policy "waitlist: client insert"
  on public.waitlist for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- purchases: Stripe checkout outcomes, written only by the platform server
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  stripe_customer_id text,
  stripe_session_id text unique,
  stripe_subscription_id text,
  price_id text,
  plan text, -- 'monthly' | 'yearly'
  amount_total integer, -- cents
  currency text,
  status text, -- Stripe subscription status: active | trialing | canceled | ...
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchases_user_id_idx on public.purchases (user_id);

alter table public.purchases enable row level security;

drop policy if exists "purchases: own rows read" on public.purchases;
create policy "purchases: own rows read"
  on public.purchases for select
  using (auth.uid () = user_id);
-- inserts/updates: service role only (bypasses RLS; no client policy on purpose)

-- ---------------------------------------------------------------------------
-- Account deletion (App Store guideline 5.1.1(v): an app with account
-- creation must let the user delete the account from inside the app).
--
-- SECURITY DEFINER is the entire mechanism: the function runs as its owner
-- (postgres), which may delete from auth.users; the caller can only ever
-- delete THEMSELVES because the row is pinned to auth.uid(). Deleting the
-- auth user cascades profiles (FK on delete cascade) and nulls the user_id
-- on app_events and purchases (on delete set null) — usage rows survive as
-- anonymous aggregates, which is what the privacy policy promises.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- ---------------------------------------------------------------------------
-- players + player_clips: the people IN the footage (player profiles).
--
-- A player is a name on someone's roster; a clip is one side of one analysed
-- match tagged with that name, carrying a small JSON summary of that side's
-- numbers (web/src/players/shape.ts defines it). The analysis itself stays in
-- the browser that ran it — footage and pose track never come here — so a
-- profile is readable from any machine without moving a match video.
-- Every policy is auth.uid() = user_id: rosters are private to whoever built
-- them (club-wide sharing is a later, deliberate step).
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  hand text check (hand in ('right', 'left')),
  notes text check (char_length(notes) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_user_id_idx on public.players (user_id);
-- One roster entry per name (case-insensitive) per user: naming the same
-- opponent twice must not fork their profile. The client treats 23505 as
-- "already have" and reuses the row.
create unique index if not exists players_user_name_idx
  on public.players (user_id, lower(btrim(name)));

alter table public.players enable row level security;

drop policy if exists "players: own rows" on public.players;
create policy "players: own rows"
  on public.players for all
  to authenticated
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

create table if not exists public.player_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  title text not null default '' check (char_length(title) <= 200),
  -- The analysis job (how a read-out finds its own tags) and this browser's
  -- library id (so the recordings list can link back on that machine).
  job_id text check (char_length(job_id) <= 120),
  history_id text check (char_length(history_id) <= 120),
  played_at date not null default current_date,
  -- Denormalised from the summary so the roster list is one light query.
  duration_sec real not null default 0 check (duration_sec >= 0),
  shots integer not null default 0 check (shots >= 0),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists player_clips_player_idx on public.player_clips (player_id, played_at);
-- A read-out has exactly one Player A and one Player B: re-tagging a side
-- replaces the earlier tag. Partial, because the demo read-out has no id.
create unique index if not exists player_clips_job_side_idx
  on public.player_clips (user_id, job_id, side) where job_id is not null;
create unique index if not exists player_clips_history_side_idx
  on public.player_clips (user_id, history_id, side) where history_id is not null;

alter table public.player_clips enable row level security;

drop policy if exists "player_clips: own rows" on public.player_clips;
create policy "player_clips: own rows"
  on public.player_clips for all
  to authenticated
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);
