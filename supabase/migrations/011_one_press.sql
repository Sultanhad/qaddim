-- Once send has been pressed, nothing automatic sends it again.
--
-- The first two applications this platform ever pressed "send" on were recorded as "the page
-- did not respond": the employer's page navigated away the moment it was clicked, which took
-- the script that was waiting for the answer with it. Both were then offered a retry button.
-- Whether either one arrived is still not known — and a retry would have been the second
-- copy of whichever did.
--
-- The extension now writes the press down *before* making it, in applications.auto_report:
--
--   "sent": { "pressed_at": …, "by": "1.6.0",
--             "outcome": "confirmed" | "code" | "rejected" | "unverified",
--             "evidence": { "kind": "text" | "url", "said": …, "url": … },
--             "verified_at": …, "rearmed": …, "previous": { … } }
--
-- This migration makes the database hold the same line the extension and the site hold, so
-- that it does not depend on every copy of the extension, every screen and every worker
-- remembering to: a press whose outcome is unknown cannot be queued, by anyone, until its
-- owner says "it did not arrive — send it again".
--
-- Nothing here removes or rewrites data. It adds one function and one trigger, and replaces
-- two functions with stricter versions of themselves.

-- "Send was pressed, and it is not known to have failed."
-- The same rule as awaitingProof() in packages/engine/src/applications.js — keep them equal.
create or replace function public.sent_unverified(report jsonb)
returns boolean language sql immutable as $$
  select coalesce(report #>> '{sent,pressed_at}', '') <> ''
     and coalesce(report #>> '{sent,rearmed}', '') in ('', 'false')
     -- `rejected` is the one outcome that proves nothing went: the form came back with errors
     and coalesce(report #>> '{sent,outcome}', '') not in ('rejected', 'confirmed');
$$;
grant execute on function public.sent_unverified(jsonb) to authenticated;

comment on function public.sent_unverified(jsonb) is
  'True when an application''s report records a press of the send button whose outcome is unknown and which its owner has not re-armed.';

-- Two rules, enforced where no caller can forget them.
create or replace function public.guard_pressed_application() returns trigger
language plpgsql as $$
begin
  -- 1. The record of a press outlives every later report. Each attempt rewrites auto_report
  --    with what it filled and what it could not; none of them may write over the fact that
  --    send was once pressed.
  --    (coalesce: a report set to NULL makes every test on it NULL, and an `if` on NULL is
  --    silently skipped — which is the one case this rule most has to catch.)
  if coalesce(jsonb_typeof(old.auto_report) = 'object' and old.auto_report ? 'sent', false)
     and not coalesce(jsonb_typeof(new.auto_report) = 'object' and new.auto_report ? 'sent', false) then
    new.auto_report :=
      (case when jsonb_typeof(new.auto_report) = 'object' then new.auto_report else '{}'::jsonb end)
      || jsonb_build_object('sent', old.auto_report -> 'sent');
  end if;

  -- 2. While that press is unresolved, the application cannot enter the queue. Whoever tried
  --    gets it handed back to its owner with the reason, rather than an error nobody reads.
  if new.auto_status = 'queued' and public.sent_unverified(new.auto_report) then
    new.auto_status := 'needs_you';
    new.auto_reason := 'ضُغط الإرسال ولم يظهر تأكيد — تحقق من بريدك قبل أي إعادة';
  end if;
  return new;
end $$;

drop trigger if exists applications_press_guard on public.applications;
create trigger applications_press_guard before update on public.applications
  for each row execute function public.guard_pressed_application();

-- The queue. Same shape as before (so `create or replace` is enough), three things stricter:
--   · nothing is handed out while its owner has paused everything;
--   · an unresolved press is never handed out, whatever its status says;
--   · an unresolved press counts as a send — against the day's cap and against "one per
--     company per week" — because for all anyone knows, it is one.
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
    -- one application per company per week, so a queue never reads as a flood
    and not exists (
      select 1
      from public.applications a2
      join public.jobs j2 on j2.id = a2.job_id
      where a2.user_id = me
        and a2.id <> a.id
        and lower(j2.company) = lower(j.company)
        and a2.auto_at > now() - interval '7 days'
        and (a2.auto_status = 'submitted' or public.sent_unverified(a2.auto_report))
    )
  order by a.created_at
  limit greatest(cap - used, 0);
end $$;
grant execute on function public.my_apply_queue() to authenticated;

-- "Try again" is for an application that stopped *before* sending. It no longer applies to
-- one that was sent-or-maybe-sent; that takes its owner's explicit word (the site writes
-- `sent.rearmed` on the report), not a button that looks like every other retry.
create or replace function public.retry_application(app_id uuid)
returns void language sql security invoker volatile as $$
  update public.applications
  set auto_status = 'queued', auto_reason = null, auto_attempts = 0
  where id = app_id and user_id = auth.uid()
    and status = 'saved'
    and not public.sent_unverified(auto_report);
$$;
grant execute on function public.retry_application(uuid) to authenticated;
