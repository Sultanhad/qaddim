-- What migration 012 promises. Run inside check-migrations.sh's throwaway database.
create function pg_temp.expect(what text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '% — got "%", wanted "%"', what, got, want; end if;
end $$;

-- a Workday board is a source like any other
insert into public.job_sources (system, slug, label) values ('workday', 'acme.wd3/Careers', 'Acme');
select pg_temp.expect('job_sources accepts workday', (select count(*)::text from public.job_sources where system = 'workday'), '1');
do $$ begin
  insert into public.job_sources (system, slug, label) values ('myspace', 'x', 'X');
  raise exception 'an unknown system was accepted';
exception when check_violation then null; end $$;

-- no pulse yet: no row, and that is itself an answer ("never ran")
select pg_temp.expect('no pulse, no row', (select count(*)::text from public.worker_health()), '0');

insert into public.ops_heartbeat (name, at, detail) values
  ('ingest', now() - interval '12 minutes', '{"host":"fly","jobs":1459,"boards":56,"errors":["lever:x"]}'),
  ('ingest:running', now(), '{"host":"fly"}');
select pg_temp.expect('a recent pass is not late', (select late::text from public.worker_health()), 'false');
select pg_temp.expect('it says where it ran', (select host from public.worker_health()), 'fly');
select pg_temp.expect('and what it saw', (select jobs::text || '/' || boards_down::text || '/' || boards::text from public.worker_health()), '1459/1/56');
select pg_temp.expect('the "running" marker is not a pulse', (select count(*)::text from public.worker_health()), '1');

update public.ops_heartbeat set at = now() - interval '41 minutes' where name = 'ingest';
select pg_temp.expect('two passes missed is late', (select late::text || ' ' || minutes_ago::text from public.worker_health()), 'true 41');

-- an hourly worker is not late at forty-one minutes; it is at two hours and a quarter
update public.ops_heartbeat set detail = detail || '{"every_min":60}' where name = 'ingest';
select pg_temp.expect('an hourly worker, 41 minutes on: not late', (select late::text from public.worker_health()), 'false');
update public.ops_heartbeat set at = now() - interval '135 minutes' where name = 'ingest';
select pg_temp.expect('an hourly worker, two passes missed: late', (select late::text from public.worker_health()), 'true');
update public.ops_heartbeat set at = now() - interval '41 minutes', detail = detail - 'every_min' where name = 'ingest';

-- anyone may ask; nobody but the service role may write the pulse
set role anon;
do $$ declare is_late boolean; begin
  select late into is_late from public.worker_health();
  if is_late is distinct from true then raise exception 'anon could not read the answer'; end if;
end $$;
do $$ begin
  update public.ops_heartbeat set at = now();
  if found then raise exception 'anon moved the pulse'; end if;
exception when insufficient_privilege then null;   -- refused outright is the same answer
end $$;
reset role;
select pg_temp.expect('and the pulse is where the worker left it', (select minutes_ago::text from public.worker_health()), '41');
