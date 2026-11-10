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
