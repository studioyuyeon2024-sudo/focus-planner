-- Focus Planner — initial schema
-- Run this once in your new Supabase project's SQL Editor.
-- Creates: profiles, blocks, pomodoros, mits, reflections + RLS + signup trigger.

-- ===== profiles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  pomo_focus_sec int not null default 1500,
  pomo_short_sec int not null default 300,
  pomo_long_sec  int not null default 900,
  day_start_h    smallint not null default 6,
  day_end_h      smallint not null default 24,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using ((select auth.uid()) = id);
create policy "own profile insert" on public.profiles for insert with check ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update using ((select auth.uid()) = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== blocks =====
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start_min smallint not null check (start_min between 0 and 1440),
  end_min   smallint not null check (end_min   between 0 and 1440),
  name text not null,
  cat  text not null check (cat in ('work','personal','rest','etc')),
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);
create index blocks_user_date_idx on public.blocks (user_id, date);
alter table public.blocks enable row level security;
create policy "own blocks all" on public.blocks for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ===== pomodoros =====
create table public.pomodoros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  started_at timestamptz not null,
  ended_at   timestamptz not null,
  mode text not null check (mode in ('focus','short','long')),
  duration_sec int not null,
  task text
);
create index pomodoros_user_date_idx on public.pomodoros (user_id, date);
alter table public.pomodoros enable row level security;
create policy "own pomos all" on public.pomodoros for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ===== mits (Most Important Tasks) =====
create table public.mits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  position smallint not null check (position between 1 and 3),
  text text not null,
  done boolean not null default false,
  unique (user_id, date, position)
);
create index mits_user_date_idx on public.mits (user_id, date);
alter table public.mits enable row level security;
create policy "own mits all" on public.mits for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ===== reflections (daily journal) =====
create table public.reflections (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood smallint check (mood between 1 and 5),
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.reflections enable row level security;
create policy "own refl all" on public.reflections for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
