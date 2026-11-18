-- Nothing is sent without its owner's approval of that very application.
--
-- Until now one switch («أرسل بنفسك») let every filled form go out unread. From here the browser
-- that applies — the server's, or the person's own Chrome — fills the form and stops; the site
-- shows what was filled; and only the person's explicit «وافق وأرسل» on that application lets
-- a browser press send, once.
--
-- What is approved is not "this job" but "these answers": the approval carries the filled
-- answers exactly as they were shown (`snapshot`). When the form is filled again to be sent,
-- the extension compares; if a single answer came out differently, nothing is pressed and the
-- new version goes back for review.
--
-- One approval is one press: it is used up atomically at the moment of pressing, so a double
-- tap, a retry, or two browsers at once cannot send it twice.
--
-- Nothing here removes or rewrites data. One table, three functions, and the queue replaced by
-- itself with a different `submit` column.

create table if not exists public.application_approvals (
  id             bigserial primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  snapshot       text not null check (length(snapshot) <= 60000),
  approved_at    timestamptz not null default now(),
  consumed_at    timestamptz,
  consumed_by    text,                    -- which browser used it: extension version, server or own
  result         text                     -- 'pressed', 'superseded', 'changed'
);
create index if not exists application_approvals_app_idx on public.application_approvals (application_id, approved_at desc);

alter table public.application_approvals enable row level security;
-- The owner may read their approvals. Nobody writes them directly: the two functions below do,
-- after checking whose application it is.
drop policy if exists approvals_own_read on public.application_approvals;
create policy approvals_own_read on public.application_approvals for select to authenticated
  using (auth.uid() = user_id);

comment on table public.application_approvals is
  'One row per «وافق وأرسل»: who approved which application, the answers they saw, and when a browser used it to press send.';

-- «وافق وأرسل». Records the approval of these answers and puts the application back in the queue.
create or replace function public.approve_application(app_id uuid, p_snapshot text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_id bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (
    select 1 from public.applications a
    where a.id = app_id and a.user_id = me and a.status = 'saved'
      and not public.sent_unverified(a.auto_report)
  ) then
    raise exception 'not an application of yours that can be sent';
  end if;
  -- an earlier approval of other answers no longer stands
  update public.application_approvals set consumed_at = now(), result = 'superseded'
    where application_id = app_id and consumed_at is null;
  insert into public.application_approvals (application_id, user_id, snapshot)
    values (app_id, me, p_snapshot) returning id into v_id;
  update public.applications set auto_status = 'queued', auto_reason = null, auto_attempts = 0
    where id = app_id and user_id = me;
  return v_id;
end $$;
revoke all on function public.approve_application(uuid, text) from public;
grant execute on function public.approve_application(uuid, text) to authenticated;

-- The moment before a press. 'ok' uses the approval up; anything else means: do not press.
--   'none'     no approval stands for this application
--   'changed'  the form came out with different answers from the ones approved
create or replace function public.consume_approval(app_id uuid, p_snapshot text, p_by text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_row public.application_approvals;
begin
  if me is null then return 'none'; end if;
  select * into v_row from public.application_approvals
    where application_id = app_id and user_id = me and consumed_at is null
    order by approved_at desc limit 1;
  if v_row.id is null then return 'none'; end if;
  if v_row.snapshot is distinct from p_snapshot then
    update public.application_approvals set consumed_at = now(), consumed_by = left(p_by, 60), result = 'changed'
      where id = v_row.id and consumed_at is null;
    return 'changed';
  end if;
  update public.application_approvals set consumed_at = now(), consumed_by = left(p_by, 60), result = 'pressed'
    where id = v_row.id and consumed_at is null;
  if not found then return 'none'; end if;       -- another browser used it a moment ago
  return 'ok';
end $$;
revoke all on function public.consume_approval(uuid, text, text) from public;
grant execute on function public.consume_approval(uuid, text, text) to authenticated;

-- The queue: as migration 016 left it, except what `submit` means. It was one switch for every
-- application; it is now "this application has an approval waiting to be used". Without one, a
-- browser fills the form and stops for review.
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
  select a.id, j.id, j.url, j.title, j.company,
         exists (select 1 from public.application_approvals ap
                 where ap.application_id = a.id and ap.consumed_at is null)
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = me
    and a.auto_status = 'queued'
    and a.status = 'saved'
    and j.is_open
    and a.auto_attempts < 3
    and not public.sent_unverified(a.auto_report)
  order by a.created_at
  limit greatest(cap - used, 0);
end $$;
grant execute on function public.my_apply_queue() to authenticated;
