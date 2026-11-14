-- What migration 011 promises, checked against the real functions and trigger.
-- Run by scripts/check-migrations.sh inside its throwaway local database, after every
-- migration has been applied — never against a hosted project.

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'press@test.local');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000a1') on conflict (id) do nothing;
update public.profiles set auto_submit = true, skip_first_three = true, daily_cap = 5
  where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.jobs (id, title, company, url, canonical_url, source) values
  ('j1', 'Analyst',    'Acme', 'https://t.local/1', 'https://t.local/1', 'test'),
  ('j2', 'Analyst II', 'ACME', 'https://t.local/2', 'https://t.local/2', 'test'),
  ('j3', 'PM',         'Beta', 'https://t.local/3', 'https://t.local/3', 'test');
insert into public.applications (id, user_id, job_id, status, auto_status, created_at) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'j1', 'saved', 'queued', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', 'j2', 'saved', 'queued', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', 'j3', 'saved', 'queued', now() - interval '1 minute');

create function pg_temp.queue() returns text language sql as
  $$ select coalesce(string_agg(job_id, ',' order by job_id), '') from public.my_apply_queue() $$;
create function pg_temp.expect(what text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '% — got "%", wanted "%"', what, got, want; end if;
end $$;
create function pg_temp.app(k text) returns public.applications language sql as
  $$ select * from public.applications where job_id = k $$;

select pg_temp.expect('before any press, everything queued is handed out', pg_temp.queue(), 'j1,j2,j3');

-- the press, as the extension records it: before the click, while still "filling"
update public.applications set auto_status = 'filling', auto_at = now(),
  auto_report = '{"filled":[{"q":"First Name","v":"Sara"}],"sent":{"pressed_at":"2026-11-12T01:00:00Z","by":"1.6.0"}}'
  where job_id = 'j1';
select pg_temp.expect('a press with no outcome is unverified', public.sent_unverified((pg_temp.app('j1')).auto_report)::text, 'true');
select pg_temp.expect('it is not handed out again; the company''s other role still is (014 lifted the weekly rule)', pg_temp.queue(), 'j2,j3');

-- the page never confirmed
update public.applications set auto_status = 'needs_you',
  auto_report = jsonb_set(auto_report, '{sent,outcome}', '"unverified"') where job_id = 'j1';

-- 1. nothing puts it back
select public.retry_application('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('retry does not requeue an unverified send', (pg_temp.app('j1')).auto_status::text, 'needs_you');
update public.applications set auto_status = 'queued', auto_reason = null where job_id = 'j1';
select pg_temp.expect('nor does writing "queued" straight onto the row', (pg_temp.app('j1')).auto_status::text, 'needs_you');
select pg_temp.expect('and the row says why', (pg_temp.app('j1')).auto_reason, 'ضُغط الإرسال ولم يظهر تأكيد — تحقق من بريدك قبل أي إعادة');
insert into public.applications (user_id, job_id, status, auto_status)
  values ('00000000-0000-0000-0000-0000000000a1', 'j1', 'saved', 'queued')
  on conflict (user_id, job_id) do update set status = excluded.status, auto_status = excluded.auto_status;
select pg_temp.expect('nor does pressing "interested" on it again', (pg_temp.app('j1')).auto_status::text, 'needs_you');
select pg_temp.expect('so the queue never offers it (its company''s other role it does)', pg_temp.queue(), 'j2,j3');

-- 2. the record of the press cannot be written over
update public.applications set auto_report = '{"missing":[{"q":"Why us?"}]}' where job_id = 'j1';
select pg_temp.expect('a later report keeps the press', (pg_temp.app('j1')).auto_report #>> '{sent,pressed_at}', '2026-11-12T01:00:00Z');
select pg_temp.expect('and carries its own contents too', (pg_temp.app('j1')).auto_report #>> '{missing,0,q}', 'Why us?');
update public.applications set auto_report = null where job_id = 'j1';
select pg_temp.expect('clearing the report keeps the press', (pg_temp.app('j1')).auto_report #>> '{sent,outcome}', 'unverified');

-- 3. it counts against the day
update public.profiles set daily_cap = 1 where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('an unverified press uses up the day''s cap', pg_temp.queue(), '');
update public.profiles set daily_cap = 5 where id = '00000000-0000-0000-0000-0000000000a1';

-- 4. only its owner's word re-arms it
update public.applications set auto_status = 'queued', auto_reason = null, auto_attempts = 0,
  auto_report = jsonb_set(auto_report, '{sent,rearmed}', '"2026-11-12T02:00:00Z"') where job_id = 'j1';
select pg_temp.expect('re-armed by its owner: back in the queue', (pg_temp.app('j1')).auto_status::text, 'queued');
select pg_temp.expect('and handed out again, with the company''s other role', pg_temp.queue(), 'j1,j2,j3');

-- 5. a form that came back with errors was never sent: ordinary retry applies
update public.applications set auto_status = 'needs_you',
  auto_report = '{"sent":{"pressed_at":"2026-11-12T03:00:00Z","outcome":"rejected"}}' where job_id = 'j3';
select public.retry_application('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('rejected by the form: retry works', (pg_temp.app('j3')).auto_status::text, 'queued');

-- 6. confirmed is sent, and is not "unverified"
update public.applications set auto_status = 'submitted', status = 'applied', auto_at = now(),
  auto_report = '{"sent":{"pressed_at":"2026-11-12T03:00:00Z","outcome":"confirmed"}}' where job_id = 'j3';
select pg_temp.expect('confirmed is not unverified', public.sent_unverified((pg_temp.app('j3')).auto_report)::text, 'false');
select public.retry_application('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('and what its owner calls applied is not requeued by retry', (pg_temp.app('j3')).auto_status::text, 'submitted');

-- 7. the kill switch
update public.profiles set answers = '{"_settings":{"paused":true}}' where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('paused: the queue hands out nothing', pg_temp.queue(), '');
select pg_temp.expect('and nothing was taken out of it', (select count(*)::text from public.applications where auto_status = 'queued'), '2');
update public.profiles set answers = '{"_settings":{"paused":false}}' where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('resumed: it flows again', pg_temp.queue(), 'j1,j2');

-- 8. an applied row that somehow still says "queued" is not handed out
update public.applications set status = 'applied' where job_id = 'j2';
select pg_temp.expect('marked applied by its owner: out of the queue', pg_temp.queue(), 'j1');
