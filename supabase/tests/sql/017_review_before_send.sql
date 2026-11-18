-- What migration 017 promises. Run inside check-migrations.sh's throwaway database.
create function pg_temp.expect(what text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '% — got "%", wanted "%"', what, got, want; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@test.local'), ('00000000-0000-0000-0000-0000000000e2', 'other@test.local');
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2') on conflict (id) do nothing;
update public.profiles set auto_submit = true, skip_first_three = true where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.jobs (id, title, company, url, canonical_url, source) values ('je1', 'Analyst', 'Acme', 'https://t.local/e1', 'https://t.local/e1', 'test');
insert into public.applications (id, user_id, job_id, status, auto_status) values
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000e1', 'je1', 'saved', 'queued');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
create function pg_temp.submit() returns text language sql as $$ select coalesce(string_agg(submit::text, ','), '') from public.my_apply_queue() $$;

select pg_temp.expect('sending switched on, but no approval: fill only', pg_temp.submit(), 'false');

-- the browser filled it and stopped; the owner approves what they saw
update public.applications set auto_status = 'needs_you' where id = '00000000-0000-0000-0000-0000000000a7';
select pg_temp.expect('approval is recorded', (select (public.approve_application('00000000-0000-0000-0000-0000000000a7', 'S1') > 0)::text), 'true');
select pg_temp.expect('and puts it back in the queue, to be sent', (select auto_status::text from public.applications where job_id = 'je1') || '/' || pg_temp.submit(), 'queued/true');

-- the press: the answers came out different → no press, and the approval is spent
select pg_temp.expect('different answers: do not press', public.consume_approval('00000000-0000-0000-0000-0000000000a7', 'S2', 'test'), 'changed');
select pg_temp.expect('and nothing stands to be pressed with', pg_temp.submit(), 'false');

-- approved again, as now filled
select public.approve_application('00000000-0000-0000-0000-0000000000a7', 'S2');
select public.approve_application('00000000-0000-0000-0000-0000000000a7', 'S2');
select pg_temp.expect('approving twice leaves one approval standing', (select count(*)::text from public.application_approvals where consumed_at is null), '1');
select pg_temp.expect('the same answers: press', public.consume_approval('00000000-0000-0000-0000-0000000000a7', 'S2', 'test'), 'ok');
select pg_temp.expect('a second press with the same approval: no', public.consume_approval('00000000-0000-0000-0000-0000000000a7', 'S2', 'test'), 'none');
select pg_temp.expect('the record says who pressed', (select result || ' ' || consumed_by from public.application_approvals where result = 'pressed'), 'pressed test');

-- someone else
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
do $$ begin
  perform public.approve_application('00000000-0000-0000-0000-0000000000a7', 'S9');
  raise exception 'approved another person''s application';
exception when raise_exception then
  if sqlerrm not like 'not an application of yours%' then raise; end if;
end $$;
select pg_temp.expect('nor can they use the owner''s approval', public.consume_approval('00000000-0000-0000-0000-0000000000a7', 'S2', 'x'), 'none');
set role authenticated;
select pg_temp.expect('and they cannot see it', (select count(*)::text from public.application_approvals), '0');
do $$ begin
  insert into public.application_approvals (application_id, user_id, snapshot) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000e2', 'S9');
  raise exception 'an approval was written directly';
exception when insufficient_privilege then null;
end $$;
reset role;

-- a send that is pressed and unconfirmed cannot be approved again (only its owner's «لم يصل» re-arms it)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
update public.applications set auto_report = '{"sent":{"pressed_at":"2026-11-18T01:00:00Z","outcome":"unverified"}}' where job_id = 'je1';
do $$ begin
  perform public.approve_application('00000000-0000-0000-0000-0000000000a7', 'S3');
  raise exception 'approved an unconfirmed send';
exception when raise_exception then
  if sqlerrm not like 'not an application of yours%' then raise; end if;
end $$;
