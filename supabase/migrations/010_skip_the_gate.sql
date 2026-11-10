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
