-- Fursa-style job platform — database schema.
-- Run once in the Supabase SQL editor of a NEW project (nothing here touches any other project).
--
-- Shape of the thing:
--   jobs          one row per real posting, shared by everyone — fetched once, scored many times
--   profiles      what each user told us about themselves
--   matches       a score per (user, job), with the reasons that produced it
--   applications  what the user did about it, and when to follow up
--
-- Every table is protected by row-level security: a user can only ever read or write their own rows.
-- `jobs` is the single exception — it is public read, because a job posting is public information.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─────────────────────────────────────────────────────────────── jobs ──
create table if not exists public.jobs (
  id                  text primary key,              -- stable hash of canonical_url
  title               text not null,
  company             text not null default '',
  location            text not null default '',
  city                text,                          -- normalised, e.g. 'riyadh'
  country             text,                          -- 'sa', 'ae', …
  arrangement         text,                          -- Remote / Hybrid / On-site / Not stated
  salary_published    text,                          -- verbatim from the source, or null. Never estimated.
  description         text not null default '',
  url                 text not null,
  canonical_url       text not null unique,
  source              text not null,                 -- 'workable:mozn-ai'
  source_type         text not null default 'ats',
  source_job_id       text,
  published_at        date,
  first_seen          timestamptz not null default now(),
  last_seen           timestamptz not null default now(),
  is_open             boolean not null default true
);
create index if not exists jobs_open_idx on public.jobs (is_open, last_seen desc);
create index if not exists jobs_city_idx on public.jobs (city) where is_open;

-- ─────────────────────────────────────────────────────────── profiles ──
create table if not exists public.profiles (
  id                  uuid primary key references auth.users on delete cascade,
  full_name           text,
  phone               text,
  roles               text[] not null default '{}',   -- ranked role-family ids
  skill_areas         text[] not null default '{}',   -- confirmed skill areas
  extra_skills        text[] not null default '{}',   -- things they really can do, e.g. SQL
  years_experience    int not null default 0,
  cities              text[] not null default '{}',
  countries           text[] not null default '{}',
  accept_remote       boolean not null default true,
  avoid_software_roles boolean not null default false,
  exclude_companies   text[] not null default '{}',
  exclude_title_words text[] not null default '{}',
  min_score           int not null default 70,
  ui_language         text not null default 'ar',
  cv_path             text,                           -- object key in the private 'cvs' bucket
  cv_uploaded_at      timestamptz,
  onboarded           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────── matches ──
create table if not exists public.matches (
  user_id    uuid not null references auth.users on delete cascade,
  job_id     text not null references public.jobs on delete cascade,
  score      int not null,
  reasons    text[] not null default '{}',            -- never a score without these
  gaps       text[] not null default '{}',
  flags      text[] not null default '{}',
  breakdown  jsonb not null default '{}'::jsonb,
  seen       boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
create index if not exists matches_feed_idx on public.matches (user_id, score desc, created_at desc);

-- ─────────────────────────────────────────────────────── applications ──
create type application_status as enum ('saved', 'applied', 'interview', 'offer', 'closed');

create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  job_id        text not null references public.jobs on delete cascade,
  status        application_status not null default 'saved',
  notes         text,
  applied_on    date,
  follow_up_on  date,                                  -- set to applied_on + 14 days
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, job_id)
);
create index if not exists applications_user_idx on public.applications (user_id, status);

-- Two weeks after you say you applied, remind you to follow up.
create or replace function public.set_follow_up() returns trigger language plpgsql as $$
begin
  if new.status = 'applied' and new.applied_on is null then
    new.applied_on := current_date;
  end if;
  if new.applied_on is not null and new.follow_up_on is null then
    new.follow_up_on := new.applied_on + 14;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists applications_follow_up on public.applications;
create trigger applications_follow_up before insert or update on public.applications
  for each row execute function public.set_follow_up();

-- ───────────────────────────────────────────────────── row-level security ──
alter table public.jobs         enable row level security;
alter table public.profiles     enable row level security;
alter table public.matches      enable row level security;
alter table public.applications enable row level security;

-- A job posting is public information; anyone signed in may read it. Only the server writes jobs.
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to authenticated using (true);

-- Everything else: you see your own rows and nobody else's.
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists matches_own on public.matches;
create policy matches_own on public.matches for select to authenticated using (auth.uid() = user_id);
drop policy if exists matches_own_update on public.matches;
create policy matches_own_update on public.matches for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists applications_own on public.applications;
create policy applications_own on public.applications for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────── CV storage (private) ──
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;

-- A CV lives under <user-id>/<filename> and is readable only by that user.
drop policy if exists cvs_own_read on storage.objects;
create policy cvs_own_read on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cvs_own_write on storage.objects;
create policy cvs_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cvs_own_delete on storage.objects;
create policy cvs_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────── a profile row for every signup ──
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────── deleting an account deletes the data ──
-- Cascades handle profiles, matches and applications. The CV object is removed by the
-- client before sign-out; this function is the server-side backstop.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, storage as $$
begin
  delete from storage.objects where bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
