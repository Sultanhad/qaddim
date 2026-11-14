-- No more "one application per company per week".
--
-- The rule held back every second application to the same employer for seven days. The owner
-- asked for it to go: what he presses «يهمني» on goes out now, however many roles at one
-- company that is. Everything else the queue enforces stays as migration 011 left it — the
-- daily cap (which still counts unconfirmed presses), the pause, the three-attempt limit, and
-- never handing out an application whose send was pressed and not confirmed.
--
-- One function replaced by itself minus one clause. No data is touched.

create or replace function public.my_apply_queue()
returns table (
  application_id uuid, job_id text, url text, title text, company text, submit boolean
)
language plpgsql security invoker stable as $$
declare
  me       uuid := auth.uid();
  cap      int;
  used     int;
  stopped  boolean;
  may_send boolean := public.my_may_submit();
begin
  select coalesce(p.daily_cap, 20), coalesce(p.answers #>> '{_settings,paused}', '') = 'true'
    into cap, stopped
  from public.profiles p where p.id = me;

  if cap is null or stopped then return; end if;

  select count(*) into used from public.applications
  where user_id = me and auto_at >= date_trunc('day', now())
    and (auto_status = 'submitted' or public.sent_unverified(auto_report));

  if used >= cap then return; end if;

  return query
  select a.id, j.id, j.url, j.title, j.company, may_send
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = me
    and a.auto_status = 'queued'
    -- its owner has not since said "applied", or closed it
    and a.status = 'saved'
    and j.is_open
    -- three tries and it waits for a person; a form that keeps failing will keep failing
    and a.auto_attempts < 3
    and not public.sent_unverified(a.auto_report)
  order by a.created_at
  limit greatest(cap - used, 0);
end $$;
grant execute on function public.my_apply_queue() to authenticated;
