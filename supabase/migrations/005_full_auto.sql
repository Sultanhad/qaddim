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
