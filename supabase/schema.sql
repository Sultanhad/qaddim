-- قدّم — database schema.
--
-- GENERATED: the migrations in supabase/migrations are the source of truth.
-- Regenerate with: sh scripts/check-migrations.sh --write
-- Paste this into a brand-new project; an existing one takes the migrations instead.

-- ───────────────────────────────────────────── 001_init.sql ──
-- قدّم — database schema (initial).
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

-- ───────────────────────────────────────────── 002_apply_sheet.sql ──
-- Adds what an application form actually asks for, so a user types each answer once.
-- Safe to run on a database that already has 001 (schema.sql) applied.

alter table public.profiles
  add column if not exists email_for_applications text,
  add column if not exists nationality            text,
  add column if not exists work_authorization     text,
  add column if not exists requires_sponsorship   boolean,
  add column if not exists salary_expectation     text,   -- verbatim, e.g. "15,500 SAR monthly"
  add column if not exists current_salary         text,
  add column if not exists notice_period          text,
  add column if not exists current_company        text,
  add column if not exists current_title          text,
  add column if not exists linkedin_url           text,
  add column if not exists education_degree       text,
  add column if not exists university             text,
  add column if not exists graduation_year        int,
  -- Free-form answers to the questions employers keep asking: { "why this company": "…" }
  add column if not exists answers                jsonb not null default '{}'::jsonb;

comment on column public.profiles.answers is
  'Answers the user wrote themselves, keyed by the question. Nothing is ever generated into this column.';

-- ───────────────────────────────────────────── 003_auto_apply.sql ──
-- Auto-apply: pressing "يهمني" queues the application, and the user's own browser works the queue.
--
-- Why the browser and not a server: every hiring system we read puts a CAPTCHA in front of submit,
-- and a CAPTCHA judges the browser, not the click. A server-driven browser fails that check even
-- when a human presses the box. The user's own Chrome passes it because it is a real browser with a
-- real history. So the queue lives here, and the extension drains it from the user's machine.

alter table public.profiles
  add column if not exists auto_apply boolean not null default false,
  add column if not exists extension_seen_at timestamptz;

comment on column public.profiles.auto_apply is
  'When true, pressing "interested" queues the job for the extension to fill and submit.';

do $$ begin
  create type auto_apply_status as enum ('queued', 'filling', 'submitted', 'needs_you', 'failed');
exception when duplicate_object then null; end $$;

alter table public.applications
  add column if not exists auto_status auto_apply_status,
  add column if not exists auto_reason text,
  add column if not exists auto_at     timestamptz,
  -- what the extension actually typed, so the user can audit any application made for them
  add column if not exists auto_report jsonb;

create index if not exists applications_queue_idx
  on public.applications (user_id, auto_status) where auto_status = 'queued';

-- The queue the extension asks for: everything still waiting, newest match first.
create or replace function public.my_apply_queue()
returns table (application_id uuid, job_id text, url text, title text, company text)
language sql security invoker stable as $$
  select a.id, j.id, j.url, j.title, j.company
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = auth.uid()
    and a.auto_status = 'queued'
    and j.is_open
  order by a.created_at
  limit 25;
$$;
grant execute on function public.my_apply_queue() to authenticated;

-- ───────────────────────────────────────────── 004_public_board.sql ──
-- The landing page shows how many jobs are open and a few of the newest ones, to a visitor who has
-- not signed in yet. A job posting is public information — the employer published it — so anonymous
-- read on `jobs` is correct. Nothing else opens: profiles, matches and applications stay private.

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to anon, authenticated using (true);

-- A small, cheap summary for the landing page: the count plus how fresh the data is.
create or replace function public.board_summary()
returns table (open_jobs bigint, companies bigint, cities bigint, last_seen timestamptz)
language sql security invoker stable as $$
  select count(*),
         count(distinct company),
         count(distinct city) filter (where city is not null),
         max(last_seen)
  from public.jobs
  where is_open;
$$;
grant execute on function public.board_summary() to anon, authenticated;

-- ───────────────────────────────────────────── 005_full_auto.sql ──
-- Sending for real, without asking each time — and the limits that make that defensible.
--
-- The switch alone is not the feature. A queue that submits as fast as it can would file
-- forty applications to one company in an afternoon, which is how a person's name becomes
-- something recruiters filter out. The caps live here rather than in the extension so they
-- hold whatever the browser does.

alter table public.profiles
  add column if not exists auto_submit boolean not null default false,
  add column if not exists daily_cap   int     not null default 20;

comment on column public.profiles.auto_submit is
  'When true, the extension presses submit itself — after the first three have been approved by hand.';
comment on column public.profiles.daily_cap is
  'Most applications that may be sent for this user in one day.';

alter table public.applications
  add column if not exists auto_attempts int not null default 0;

-- How many were approved by hand. Until this reaches three, filling stops at the submit
-- button so the person sees, with their own eyes, what is going out under their name.
create or replace function public.my_approved_count()
returns int language sql security invoker stable as $$
  select count(*)::int from public.applications
  where user_id = auth.uid() and status in ('applied', 'interview', 'offer');
$$;
grant execute on function public.my_approved_count() to authenticated;

-- What the site shows, and what the extension needs to decide.
create or replace function public.my_apply_stats()
returns table (
  queued int, sent_today int, cap int, approved int, auto_submit boolean,
  submitting boolean, needs_you int
)
language sql security invoker stable as $$
  select
    (select count(*)::int from public.applications where user_id = auth.uid() and auto_status = 'queued'),
    (select count(*)::int from public.applications
      where user_id = auth.uid() and auto_status = 'submitted' and auto_at >= date_trunc('day', now())),
    (select coalesce(daily_cap, 20) from public.profiles where id = auth.uid()),
    public.my_approved_count(),
    (select coalesce(auto_submit, false) from public.profiles where id = auth.uid()),
    (select coalesce(auto_submit, false) from public.profiles where id = auth.uid())
      and public.my_approved_count() >= 3,
    (select count(*)::int from public.applications where user_id = auth.uid() and auto_status = 'needs_you');
$$;
grant execute on function public.my_apply_stats() to authenticated;

-- The queue, now with the limits applied and with the decision the extension must obey.
-- Postgres will not let `create or replace` change a function's return type, and this one
-- gains a column — so the old one has to go first.
drop function if exists public.my_apply_queue();
create or replace function public.my_apply_queue()
returns table (
  application_id uuid, job_id text, url text, title text, company text, submit boolean
)
language plpgsql security invoker stable as $$
declare
  me       uuid := auth.uid();
  cap      int;
  used     int;
  may_send boolean;
begin
  select coalesce(p.daily_cap, 20),
         coalesce(p.auto_submit, false) and public.my_approved_count() >= 3
    into cap, may_send
  from public.profiles p where p.id = me;

  select count(*) into used from public.applications
  where user_id = me and auto_status = 'submitted' and auto_at >= date_trunc('day', now());

  if cap is null or used >= cap then return; end if;

  return query
  select a.id, j.id, j.url, j.title, j.company, may_send
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = me
    and a.auto_status = 'queued'
    and j.is_open
    -- three tries and it waits for a person; a form that keeps failing will keep failing
    and a.auto_attempts < 3
    -- one application per company per week, so a queue never reads as a flood
    and not exists (
      select 1
      from public.applications a2
      join public.jobs j2 on j2.id = a2.job_id
      where a2.user_id = me
        and a2.id <> a.id
        and lower(j2.company) = lower(j.company)
        and a2.auto_status = 'submitted'
        and a2.auto_at > now() - interval '7 days'
    )
  order by a.created_at
  limit greatest(cap - used, 0);
end $$;
grant execute on function public.my_apply_queue() to authenticated;

-- Answering a question that stopped an application, and putting it back in the queue.
create or replace function public.retry_application(app_id uuid)
returns void language sql security invoker volatile as $$
  update public.applications
  set auto_status = 'queued', auto_reason = null, auto_attempts = 0
  where id = app_id and user_id = auth.uid();
$$;
grant execute on function public.retry_application(uuid) to authenticated;

-- ───────────────────────────────────────────── 006_account_deletion_and_limits.sql ──
-- Two things the audit found broken or unguarded.
--
-- 1. Account deletion never worked. Supabase forbids DELETE on storage.objects from SQL
--    ("Use the Storage API instead"), so delete_my_account() raised on its first line, the
--    account survived, and the app signed the user out as if it were gone. The function now
--    does only what SQL can do — remove the auth user, which cascades to the profile and
--    applications — and the app removes the CV folder through the Storage API before calling it.
--
-- 2. Nothing checked the values the app writes. The anti-spam caps that make automatic
--    sending defensible were settable to anything by anyone with a session. These constraints
--    hold whatever the client does.

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- Bounds on what a profile may claim. Ranges are generous on purpose; they stop nonsense,
-- not edge cases.
alter table public.profiles
  drop constraint if exists profiles_daily_cap_range,
  drop constraint if exists profiles_min_score_range,
  drop constraint if exists profiles_years_range,
  drop constraint if exists profiles_graduation_year_range,
  drop constraint if exists profiles_text_lengths,
  drop constraint if exists profiles_lists_bounded,
  drop constraint if exists profiles_answers_bounded;

alter table public.profiles
  add constraint profiles_daily_cap_range      check (daily_cap between 1 and 40),
  add constraint profiles_min_score_range      check (min_score between 0 and 100),
  add constraint profiles_years_range          check (years_experience between 0 and 60),
  add constraint profiles_graduation_year_range check (graduation_year is null or graduation_year between 1950 and 2035),
  add constraint profiles_text_lengths check (
    coalesce(length(full_name), 0) <= 120 and
    coalesce(length(phone), 0) <= 40 and
    coalesce(length(email_for_applications), 0) <= 254 and
    coalesce(length(nationality), 0) <= 80 and
    coalesce(length(work_authorization), 0) <= 80 and
    coalesce(length(current_title), 0) <= 160 and
    coalesce(length(current_company), 0) <= 160 and
    coalesce(length(salary_expectation), 0) <= 80 and
    coalesce(length(current_salary), 0) <= 80 and
    coalesce(length(notice_period), 0) <= 80 and
    coalesce(length(education_degree), 0) <= 80 and
    coalesce(length(university), 0) <= 160 and
    coalesce(length(linkedin_url), 0) <= 300
  ),
  add constraint profiles_lists_bounded check (
    cardinality(roles) <= 20 and cardinality(skill_areas) <= 20 and cardinality(extra_skills) <= 60 and
    cardinality(cities) <= 30 and cardinality(countries) <= 12 and
    cardinality(exclude_companies) <= 100 and cardinality(exclude_title_words) <= 100
  ),
  -- the free-text answers the robot types into forms: bounded so a profile cannot carry megabytes
  add constraint profiles_answers_bounded check (answers is null or pg_column_size(answers) <= 65536);

alter table public.applications
  drop constraint if exists applications_notes_length,
  drop constraint if exists applications_attempts_range;
alter table public.applications
  add constraint applications_notes_length  check (coalesce(length(notes), 0) <= 4000),
  add constraint applications_attempts_range check (auto_attempts between 0 and 10);

-- The queries the app actually runs, indexed. (jobs_open_idx and the queue index exist already.)
create index if not exists applications_user_updated_idx on public.applications (user_id, updated_at desc);
create index if not exists applications_user_status_idx  on public.applications (user_id, status);
create index if not exists jobs_country_open_idx on public.jobs (country) where is_open;
create index if not exists jobs_published_idx    on public.jobs (published_at desc nulls last) where is_open;

-- ───────────────────────────────────────────── 007_job_lifecycle_and_sources.sql ──
-- Phase 3 groundwork: a job has a life, and the list of boards lives in the database.
--
-- Until now a posting was either is_open or not, and the audit found 94 "open" postings older
-- than six months (some from 2021) because nothing ever re-checked them. And the boards we
-- read were a hard-coded array in boards.js, so adding one meant a deploy. Both move here.
-- Nothing is dropped; is_open stays as the fast filter the app already uses.

-- ── job lifecycle ───────────────────────────────────────────────────────────
do $$ begin
  create type job_status as enum ('pending', 'verified', 'rejected', 'expired', 'closed');
exception when duplicate_object then null; end $$;

alter table public.jobs
  add column if not exists status       job_status not null default 'pending',
  add column if not exists verified_at  timestamptz,
  add column if not exists checked_at   timestamptz,   -- last time the posting URL was fetched
  add column if not exists check_status int,           -- HTTP status of that fetch
  add column if not exists expires_at   date,          -- from the board when it says; else derived
  add column if not exists closed_at    timestamptz;

comment on column public.jobs.status is
  'pending: stored, not yet re-checked · verified: URL answered 200 recently · rejected: failed sanity checks · expired: past expires_at or stale · closed: gone from its board';

-- What exists came from the employers'' own boards, so it starts verified; closed stays closed.
update public.jobs set status = 'verified', verified_at = coalesce(verified_at, last_seen)
  where status = 'pending' and is_open;
update public.jobs set status = 'closed', closed_at = coalesce(closed_at, last_seen)
  where status = 'pending' and not is_open;

create index if not exists jobs_status_idx  on public.jobs (status);
create index if not exists jobs_checked_idx on public.jobs (checked_at nulls first) where is_open;

-- ── sources, managed as data ────────────────────────────────────────────────
create table if not exists public.job_sources (
  id            uuid primary key default gen_random_uuid(),
  system        text not null check (system in ('ashby', 'lever', 'greenhouse', 'workable', 'smartrecruiters', 'recruitee')),
  slug          text not null,
  label         text not null,
  country       text,                                   -- hint for adapters that need one
  enabled       boolean not null default true,
  status        text not null default 'pending' check (status in ('pending', 'verified', 'failing', 'disabled')),
  every_minutes int  not null default 15 check (every_minutes between 5 and 1440),
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  jobs_count    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (system, slug)
);
comment on table public.job_sources is 'The hiring boards the worker reads. Seeded from boards.js; edited here once an admin screen exists.';

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists job_sources_touch on public.job_sources;
create trigger job_sources_touch before update on public.job_sources
  for each row execute function public.touch_updated_at();

alter table public.job_sources enable row level security;
-- Anyone may see which boards are read (the landing page says so already). Only the
-- service role writes, until roles exist.
drop policy if exists job_sources_read on public.job_sources;
create policy job_sources_read on public.job_sources for select to anon, authenticated using (enabled);

create table if not exists public.source_runs (
  id          bigserial primary key,
  source_id   uuid references public.job_sources (id) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  jobs_seen   int,
  jobs_new    int,
  jobs_closed int,
  error       text
);
create index if not exists source_runs_source_idx on public.source_runs (source_id, started_at desc);
alter table public.source_runs enable row level security;   -- no policies: service role only

-- ── a pulse from the worker ─────────────────────────────────────────────────
-- The audit found a 46-hour gap nobody noticed. The worker writes a row each run; anything
-- that can read it (the site, a check script) can tell how long it has been quiet.
create table if not exists public.ops_heartbeat (
  name   text primary key,
  at     timestamptz not null default now(),
  detail jsonb
);
alter table public.ops_heartbeat enable row level security;
drop policy if exists heartbeat_read on public.ops_heartbeat;
create policy heartbeat_read on public.ops_heartbeat for select to anon, authenticated using (true);

-- board_summary now also says when the worker last ran, so the landing page can be honest
-- about freshness instead of implying "every 15 minutes" while the laptop sleeps.
drop function if exists public.board_summary();
create function public.board_summary()
returns table (open_jobs bigint, companies bigint, cities bigint, last_seen timestamptz, worker_at timestamptz)
language sql security invoker stable as $$
  select count(*),
         count(distinct company),
         count(distinct city) filter (where city is not null),
         max(last_seen),
         (select at from public.ops_heartbeat where name = 'ingest')
  from public.jobs
  where is_open;
$$;
grant execute on function public.board_summary() to anon, authenticated;

-- ───────────────────────────────────────────── 008_application_timeline.sql ──
-- A job application has a life, and right now it has five words and no memory.
--
-- The five statuses skip the two stages people actually wait in — a recruiter screen and an
-- assessment — and they cannot tell "I withdrew" from "they said no", which is the one
-- distinction a person looking back at their search wants. And nothing records *when* any of
-- it happened, so "قدّمت" could be yesterday or in March.

do $$ begin
  alter type application_status add value if not exists 'under_review' after 'applied';
exception when others then null; end $$;
do $$ begin
  alter type application_status add value if not exists 'assessment' after 'under_review';
exception when others then null; end $$;
do $$ begin
  alter type application_status add value if not exists 'rejected' after 'offer';
exception when others then null; end $$;
do $$ begin
  alter type application_status add value if not exists 'withdrawn' after 'rejected';
exception when others then null; end $$;

-- `closed` stays as it is: a job dismissed before applying ("لا يناسبني"), which is not the
-- same thing as an employer saying no.
comment on type application_status is
  'saved → applied → under_review → assessment → interview → offer, ending in rejected or withdrawn. closed means dismissed before applying.';

create table if not exists public.application_events (
  id             bigserial primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  at             timestamptz not null default now(),
  kind           text not null check (kind in ('status', 'note', 'auto', 'reminder')),
  from_status    application_status,
  to_status      application_status,
  detail         text check (coalesce(length(detail), 0) <= 2000)
);
create index if not exists application_events_app_idx on public.application_events (application_id, at desc);
create index if not exists application_events_user_idx on public.application_events (user_id, at desc);

alter table public.application_events enable row level security;
drop policy if exists application_events_own on public.application_events;
create policy application_events_own on public.application_events for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Written by the database, not by whichever screen happened to make the change — the browser,
-- the extension and the worker all move these rows, and a history only one of them maintains
-- is a history with holes.
create or replace function public.log_application_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (application_id, user_id, kind, to_status, detail)
    values (new.id, new.user_id, 'status', new.status, null);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.application_events (application_id, user_id, kind, from_status, to_status)
    values (new.id, new.user_id, 'status', old.status, new.status);
  end if;

  if new.auto_status is distinct from old.auto_status then
    insert into public.application_events (application_id, user_id, kind, detail)
    values (new.id, new.user_id, 'auto', coalesce(new.auto_status::text, '—') ||
      case when new.auto_reason is not null then ' — ' || new.auto_reason else '' end);
  end if;

  return new;
end $$;

drop trigger if exists applications_log on public.applications;
create trigger applications_log after insert or update on public.applications
  for each row execute function public.log_application_change();

-- Backfill: every application that exists got there somehow, and its row already knows when.
insert into public.application_events (application_id, user_id, at, kind, to_status, detail)
select a.id, a.user_id, coalesce(a.created_at, now()), 'status', 'saved', 'قبل تسجيل الأحداث'
from public.applications a
where not exists (select 1 from public.application_events e where e.application_id = a.id);

-- ───────────────────────────────────────────── 009_hands_off.sql ──
-- Applying without being asked each time.
--
-- Until now the queue only ever filled by hand: a person read a card and pressed "يهمني".
-- Everything downstream was automatic, but the first step was not — so the platform could
-- only work as fast as its owner read. This lets the worker put strong matches in the queue
-- itself, bounded by the same caps that already hold for everything else.
--
-- What it deliberately does NOT do: lower the bar. Below the user's own threshold nothing is
-- queued, one per company per week still holds, the daily cap still holds, and the first
-- three still wait for a person — because the first three are how someone finds out what
-- goes out under their name.

alter table public.profiles
  add column if not exists auto_queue boolean not null default false,
  add column if not exists auto_queue_above int not null default 75;

comment on column public.profiles.auto_queue is
  'When true, the worker queues strong matches itself instead of waiting for the user to press interested.';
comment on column public.profiles.auto_queue_above is
  'Only matches scoring at least this are queued without being asked. Deliberately higher than min_score, which only governs what is shown.';

alter table public.profiles
  drop constraint if exists profiles_auto_queue_above_range;
alter table public.profiles
  add constraint profiles_auto_queue_above_range check (auto_queue_above between 50 and 100);

-- A row the user never touched, so it is worth saying who put it there.
alter table public.applications
  add column if not exists queued_by text not null default 'user' check (queued_by in ('user', 'auto'));

comment on column public.applications.queued_by is
  'user: they pressed interested. auto: the worker queued it from their rules.';

-- How many went out today without being asked, so the site can say so plainly.
-- Postgres will not let `create or replace` add a column to a function's result, so the old
-- one goes first. (The same thing caught migration 005.)
drop function if exists public.my_apply_stats();
create or replace function public.my_apply_stats()
returns table (
  queued int, sent_today int, cap int, approved int, auto_submit boolean,
  submitting boolean, needs_you int, auto_today int
)
language sql security invoker stable as $$
  select
    (select count(*)::int from public.applications where user_id = auth.uid() and auto_status = 'queued'),
    (select count(*)::int from public.applications
      where user_id = auth.uid() and auto_status = 'submitted' and auto_at >= date_trunc('day', now())),
    (select coalesce(daily_cap, 20) from public.profiles where id = auth.uid()),
    public.my_approved_count(),
    (select coalesce(auto_submit, false) from public.profiles where id = auth.uid()),
    (select coalesce(auto_submit, false) from public.profiles where id = auth.uid())
      and public.my_approved_count() >= 3,
    (select count(*)::int from public.applications where user_id = auth.uid() and auto_status = 'needs_you'),
    (select count(*)::int from public.applications
      where user_id = auth.uid() and queued_by = 'auto' and created_at >= date_trunc('day', now()));
$$;
grant execute on function public.my_apply_stats() to authenticated;

-- ───────────────────────────────────────────── 010_skip_the_gate.sql ──
-- The first-three rule, made the owner's choice rather than the author's.
--
-- Filling the first three applications and leaving the submit button to a person is how
-- someone finds out, with their own eyes, what goes out under their name — so it stays the
-- default, and a stranger signing up tomorrow still gets it.
--
-- But it is a safeguard, not a law. Someone who has read the fill sheet, knows exactly what
-- the robot types, and wants "interested" to mean "apply", is entitled to say so. The switch
-- is theirs, it is visible, and it is reversible.

alter table public.profiles
  add column if not exists skip_first_three boolean not null default false;

comment on column public.profiles.skip_first_three is
  'When true, applications are submitted from the first one — no three-by-hand warm-up. Off by default.';

-- The gate now asks the profile instead of asserting a number.
create or replace function public.my_may_submit()
returns boolean language sql security invoker stable as $$
  select coalesce(p.auto_submit, false)
     and (coalesce(p.skip_first_three, false) or public.my_approved_count() >= 3)
  from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.my_may_submit() to authenticated;

drop function if exists public.my_apply_stats();
create function public.my_apply_stats()
returns table (
  queued int, sent_today int, cap int, approved int, auto_submit boolean,
  submitting boolean, needs_you int, auto_today int, skipped_gate boolean
)
language sql security invoker stable as $$
  select
    (select count(*)::int from public.applications where user_id = auth.uid() and auto_status = 'queued'),
    (select count(*)::int from public.applications
      where user_id = auth.uid() and auto_status = 'submitted' and auto_at >= date_trunc('day', now())),
    (select coalesce(daily_cap, 20) from public.profiles where id = auth.uid()),
    public.my_approved_count(),
    (select coalesce(auto_submit, false) from public.profiles where id = auth.uid()),
    public.my_may_submit(),
    (select count(*)::int from public.applications where user_id = auth.uid() and auto_status = 'needs_you'),
    (select count(*)::int from public.applications
      where user_id = auth.uid() and queued_by = 'auto' and created_at >= date_trunc('day', now())),
    (select coalesce(skip_first_three, false) from public.profiles where id = auth.uid());
$$;
grant execute on function public.my_apply_stats() to authenticated;

drop function if exists public.my_apply_queue();
create function public.my_apply_queue()
returns table (
  application_id uuid, job_id text, url text, title text, company text, submit boolean
)
language plpgsql security invoker stable as $$
declare
  me       uuid := auth.uid();
  cap      int;
  used     int;
  may_send boolean := public.my_may_submit();
begin
  select coalesce(p.daily_cap, 20) into cap from public.profiles p where p.id = me;

  select count(*) into used from public.applications
  where user_id = me and auto_status = 'submitted' and auto_at >= date_trunc('day', now());

  if cap is null or used >= cap then return; end if;

  return query
  select a.id, j.id, j.url, j.title, j.company, may_send
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = me
    and a.auto_status = 'queued'
    and j.is_open
    -- three tries and it waits for a person; a form that keeps failing will keep failing
    and a.auto_attempts < 3
    -- one application per company per week, so a queue never reads as a flood
    and not exists (
      select 1
      from public.applications a2
      join public.jobs j2 on j2.id = a2.job_id
      where a2.user_id = me
        and a2.id <> a.id
        and lower(j2.company) = lower(j.company)
        and a2.auto_status = 'submitted'
        and a2.auto_at > now() - interval '7 days'
    )
  order by a.created_at
  limit greatest(cap - used, 0);
end $$;
grant execute on function public.my_apply_queue() to authenticated;

