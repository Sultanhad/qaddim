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
