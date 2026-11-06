-- Auto-apply: pressing "يهمني" queues the application, and the user's own browser works the queue.
--
-- Why the browser and not a server: every hiring system we read puts a CAPTCHA in front of submit,
-- and a CAPTCHA judges the browser, not the click. A server-driven browser fails that check even
-- when a human presses the box. The user's own Chrome passes it because it is a real browser with a
-- real history. So the queue lives here, and the extension drains it from the user's machine.

alter table public.profiles
  add column if not exists auto_apply boolean not null default false,
  add column if not exists extension_seen_at timestamptz;

comment on column public.profiles.auto_apply is
  'When true, pressing "interested" queues the job for the extension to fill and submit.';

do $$ begin
  create type auto_apply_status as enum ('queued', 'filling', 'submitted', 'needs_you', 'failed');
exception when duplicate_object then null; end $$;

alter table public.applications
  add column if not exists auto_status auto_apply_status,
  add column if not exists auto_reason text,
  add column if not exists auto_at     timestamptz,
  -- what the extension actually typed, so the user can audit any application made for them
  add column if not exists auto_report jsonb;

create index if not exists applications_queue_idx
  on public.applications (user_id, auto_status) where auto_status = 'queued';

-- The queue the extension asks for: everything still waiting, newest match first.
create or replace function public.my_apply_queue()
returns table (application_id uuid, job_id text, url text, title text, company text)
language sql security invoker stable as $$
  select a.id, j.id, j.url, j.title, j.company
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = auth.uid()
    and a.auto_status = 'queued'
    and j.is_open
  order by a.created_at
  limit 25;
$$;
grant execute on function public.my_apply_queue() to authenticated;
