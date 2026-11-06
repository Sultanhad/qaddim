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
