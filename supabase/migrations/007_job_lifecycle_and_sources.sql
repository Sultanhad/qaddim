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
