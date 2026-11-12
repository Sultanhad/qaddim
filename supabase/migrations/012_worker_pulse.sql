-- The worker, readable from outside it.
--
-- Two small things the move from a laptop to a server needs.
--
-- 1. `job_sources` did not know Workday. The list of hiring systems it accepts was written
--    before the Workday adapter existed, so every pass's attempt to keep that table in step
--    with the code failed on the first Workday board — the whole batch, every fifteen minutes,
--    for weeks — and the worker reported it as "apply migration 007", which had been applied.
--
-- 2. A question anyone may ask: is the worker alive? The pulse already exists (ops_heartbeat,
--    migration 007) and is already public. What was missing is the answer worked out in one
--    place, so that the check that raises the alarm and the page that shows "last updated"
--    cannot disagree about what "late" means.
--
-- Nothing here removes or rewrites data.

alter table public.job_sources drop constraint if exists job_sources_system_check;
alter table public.job_sources add constraint job_sources_system_check
  check (system in ('ashby', 'lever', 'greenhouse', 'workable', 'smartrecruiters', 'recruitee', 'workday'));

-- How long since the last complete pass, and what it saw. The worker writes how often it is
-- meant to run into its pulse (`every_min`: an hour on the hosted runner, a quarter of one on a
-- laptop); "late" is two of those missed in a row, with ten minutes' patience for a slow start.
create or replace function public.worker_health()
returns table (
  last_pass   timestamptz,   -- when the last complete pass finished
  minutes_ago int,
  late        boolean,       -- two passes missed
  host        text,          -- 'fly', 'laptop' — where that pass ran
  jobs        int,           -- postings it read
  boards      int,           -- boards it tried
  boards_down int            -- boards that did not answer it
)
language sql security invoker stable as $$
  select h.at,
         (extract(epoch from now() - h.at) / 60)::int,
         now() - h.at > make_interval(mins => 2 * coalesce((h.detail ->> 'every_min')::int, 15) + 10),
         h.detail ->> 'host',
         (h.detail ->> 'jobs')::int,
         (h.detail ->> 'boards')::int,
         coalesce(jsonb_array_length(h.detail -> 'errors'), 0)
  from public.ops_heartbeat h
  where h.name = 'ingest';
$$;
grant execute on function public.worker_health() to anon, authenticated;

comment on function public.worker_health() is
  'Is the worker alive: when its last complete pass finished, where it ran, and whether two passes have been missed.';
