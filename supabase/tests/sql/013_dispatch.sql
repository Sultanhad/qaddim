-- What migration 013 promises. Run inside check-migrations.sh's throwaway database, where pg_net
-- records requests instead of sending them.
create function pg_temp.expect(what text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '% — got "%", wanted "%"', what, got, want; end if;
end $$;
create function pg_temp.calls(wf text) returns text language sql as
  $$ select count(*)::text from net.calls where url like '%/' || wf || '/dispatches' $$;

select pg_temp.expect('the minute job is scheduled', (select schedule || ' ' || command from cron.job where jobname = 'qaddim-tick'), '* * * * * select ops.tick()');

-- without the owner's token: nothing at all
select ops.tick();
select pg_temp.expect('no token, no request', (select count(*)::text from net.calls), '0');
select pg_temp.expect('and nothing written down', (select count(*)::text from ops.dispatches), '0');

insert into vault.decrypted_secrets values ('github_dispatch_token', 'gh-test-token');
select ops.tick();
select pg_temp.expect('the worker is started', pg_temp.calls('worker.yml'), '1');
select pg_temp.expect('and the pulse', pg_temp.calls('pulse.yml'), '1');
select pg_temp.expect('the server browser is not, with nothing waiting', pg_temp.calls('apply.yml'), '0');
select pg_temp.expect('on main, at this repository only',
  (select body::text || ' ' || url from net.calls where url like '%worker.yml%'),
  '{"ref": "main"} https://api.github.com/repos/Sultanhad/qaddim/actions/workflows/worker.yml/dispatches');
select pg_temp.expect('with the token', (select headers ->> 'Authorization' from net.calls where url like '%worker.yml%'), 'Bearer gh-test-token');

select ops.tick();
select pg_temp.expect('a minute later: not again', pg_temp.calls('worker.yml') || '/' || pg_temp.calls('pulse.yml'), '1/1');
update ops.dispatches set at = at - interval '15 minutes' where workflow = 'worker.yml';
select ops.tick();
select pg_temp.expect('fifteen minutes later: again', pg_temp.calls('worker.yml'), '2');

-- The clock is moved back below rather than waited for; the trigger that stamps updated_at
-- on every write would put it forward again, so it is held off for this test.
alter table public.applications disable trigger applications_follow_up;

-- someone who chose the server, and someone who did not
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'srv@test.local'), ('00000000-0000-0000-0000-0000000000d2', 'own@test.local');
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2') on conflict (id) do nothing;
update public.profiles set auto_apply = true, answers = '{"_settings":{"server":true}}' where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set auto_apply = true, answers = '{}' where id = '00000000-0000-0000-0000-0000000000d2';
insert into public.jobs (id, title, company, url, canonical_url, source) values
  ('jd1', 'A', 'Acme', 'https://t.local/d1', 'https://t.local/d1', 'test'),
  ('jd2', 'B', 'Beta', 'https://t.local/d2', 'https://t.local/d2', 'test');

insert into public.applications (user_id, job_id, status, auto_status) values ('00000000-0000-0000-0000-0000000000d2', 'jd1', 'saved', 'queued');
select ops.tick();
select pg_temp.expect('queued by someone with their own browser: no server', pg_temp.calls('apply.yml'), '0');

insert into public.applications (user_id, job_id, status, auto_status) values ('00000000-0000-0000-0000-0000000000d1', 'jd1', 'saved', 'queued');
select ops.tick();
select pg_temp.expect('queued by someone who chose the server: started at once', pg_temp.calls('apply.yml'), '1');
-- two minutes on (the clock is moved back rather than waited for, application and all)
update ops.dispatches set at = at - interval '2 minutes' where workflow = 'apply.yml';
update public.applications set updated_at = updated_at - interval '3 minutes';
select ops.tick();
select pg_temp.expect('the same queue, nothing new: not started again', pg_temp.calls('apply.yml'), '1');

insert into public.applications (user_id, job_id, status, auto_status) values ('00000000-0000-0000-0000-0000000000d1', 'jd2', 'saved', 'queued');
select ops.tick();
select pg_temp.expect('something new: started again', pg_temp.calls('apply.yml'), '2');

update ops.dispatches set at = at - interval '2 minutes' where workflow = 'apply.yml';
update public.applications set updated_at = now() where job_id = 'jd2' and user_id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set answers = '{"_settings":{"server":true,"paused":true}}' where id = '00000000-0000-0000-0000-0000000000d1';
select ops.tick();
select pg_temp.expect('stopped by its owner: not started', pg_temp.calls('apply.yml'), '2');

-- held back for hours (the daily cap): looked at again after three
update public.profiles set answers = '{"_settings":{"server":true}}' where id = '00000000-0000-0000-0000-0000000000d1';
update ops.dispatches set at = now() - interval '4 hours' where workflow = 'apply.yml';
update public.applications set updated_at = now() - interval '5 hours' where user_id = '00000000-0000-0000-0000-0000000000d1';
select ops.tick();
select pg_temp.expect('three hours on, the same queue: started once more', pg_temp.calls('apply.yml'), '3');

-- only the three names
do $$ begin
  perform ops.dispatch('anything-else.yml', 'x', interval '1 minute');
  raise exception 'another workflow was started';
exception when raise_exception then
  if sqlerrm not like 'not a workflow%' then raise; end if;
end $$;

-- what GitHub answered is readable by anyone; starting anything is not
insert into net._http_response (id, status_code) select id, 204 from net.calls;
update net._http_response set status_code = 401 where id = (select max(id) from net.calls where url like '%worker.yml%');
select pg_temp.expect('the last answer per workflow', (select string_agg(workflow || '=' || status, ' ' order by workflow) from public.dispatch_health()), 'apply.yml=204 pulse.yml=204 worker.yml=401');
set role anon;
select pg_temp.expect('anon may read it', (select count(*)::text from public.dispatch_health()), '3');
do $$ begin
  perform ops.dispatch('worker.yml', 'x', interval '0');
  raise exception 'anon started a workflow';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform ops.tick();
  raise exception 'anon ran the tick';
exception when insufficient_privilege then null;
end $$;
reset role;
alter table public.applications enable trigger applications_follow_up;
