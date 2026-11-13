-- The database keeps the time, and tells GitHub when to start.
--
-- The worker and the server's browser run on GitHub Actions, and GitHub's own scheduler started
-- them every six to eight hours instead of every hour: ten scheduled runs in thirty-six hours.
-- An application sent from a phone could wait most of a working day before anything opened it.
--
-- Supabase's scheduler (pg_cron) runs on time. Once a minute it looks at two things and, when
-- one is due, asks GitHub to start the workflow through its API (pg_net):
--   · the worker, every fifteen minutes; the pulse, every thirty;
--   · the server's browser, as soon as someone who chose «وقدّم من الخادم» has something new
--     in the queue — so "interested" pressed on a phone starts within a minute or two.
--
-- The key this needs is created by the owner (a GitHub token that can only start this
-- repository's workflows) and stored by them in Supabase Vault as `github_dispatch_token`.
-- It is never in this file, never in a table, and nothing that a browser can call reads it.
-- Without it, this does nothing at all.
--
-- Nothing here removes or rewrites existing data.

create schema if not exists ops;
revoke all on schema ops from public;
comment on schema ops is 'Operations the database runs on its own. Not exposed through the API.';

-- What was asked of GitHub, and when. pg_net keeps the answer (for a few hours) under request_id.
create table if not exists ops.dispatches (
  id         bigserial primary key,
  workflow   text not null,
  at         timestamptz not null default now(),
  reason     text,
  request_id bigint
);
create index if not exists dispatches_workflow_at_idx on ops.dispatches (workflow, at desc);

-- Start one workflow, unless it was started less than `min_gap` ago. Only these three names;
-- only this repository; only `main`.
create or replace function ops.dispatch(p_workflow text, p_reason text, p_min_gap interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_request bigint;
begin
  if p_workflow not in ('worker.yml', 'apply.yml', 'pulse.yml') then
    raise exception 'not a workflow this may start: %', p_workflow;
  end if;
  if exists (select 1 from ops.dispatches d where d.workflow = p_workflow and d.at > now() - p_min_gap) then
    return false;
  end if;
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'github_dispatch_token' limit 1;
  if coalesce(v_token, '') = '' then
    return false;                         -- not set up: do nothing, and say nothing every minute
  end if;
  v_request := net.http_post(
    url := 'https://api.github.com/repos/Sultanhad/qaddim/actions/workflows/' || p_workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'qaddim-dispatch',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
  insert into ops.dispatches (workflow, reason, request_id) values (p_workflow, p_reason, v_request);
  return true;
end $$;
revoke all on function ops.dispatch(text, text, interval) from public;

-- Once a minute.
create or replace function ops.tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_last_apply timestamptz;
begin
  perform ops.dispatch('worker.yml', 'every 15 minutes', interval '14 minutes');
  perform ops.dispatch('pulse.yml', 'every 30 minutes', interval '29 minutes');

  -- The server's browser: only when it has something to do. "New" is anything queued since it
  -- was last started — so an application held back by the daily cap or the one-per-company
  -- rule does not start it again every minute for nothing; those are looked at every three hours.
  select max(d.at) into v_last_apply from ops.dispatches d where d.workflow = 'apply.yml';
  if exists (
    select 1
    from public.applications a
    join public.profiles p on p.id = a.user_id
    where a.status = 'saved' and a.auto_status = 'queued'
      and p.auto_apply
      and coalesce(p.answers #>> '{_settings,server}', '') = 'true'
      and coalesce(p.answers #>> '{_settings,paused}', '') <> 'true'
      and (v_last_apply is null or a.updated_at > v_last_apply or v_last_apply < now() - interval '3 hours')
  ) then
    perform ops.dispatch('apply.yml', 'something new in the queue', interval '1 minute');
  end if;

  delete from ops.dispatches where at < now() - interval '7 days';
end $$;
revoke all on function ops.tick() from public;

select cron.schedule('qaddim-tick', '* * * * *', 'select ops.tick()');

-- Whether GitHub accepted the last request for each workflow (it answers 204). A token that
-- expired or was revoked shows here as 401 or 403 — and in the pulse, which reads this.
create or replace function public.dispatch_health()
returns table (workflow text, last_at timestamptz, status int, error text)
language sql security definer set search_path = '' stable as $$
  select distinct on (d.workflow) d.workflow, d.at, r.status_code,
         coalesce(r.error_msg, case when r.timed_out then 'timed out' end)
  from ops.dispatches d
  left join net._http_response r on r.id = d.request_id
  order by d.workflow, d.at desc;
$$;
grant execute on function public.dispatch_health() to anon, authenticated;

comment on function public.dispatch_health() is
  'When the database last asked GitHub to start each workflow, and what GitHub answered (204 is yes).';
