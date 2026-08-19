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
