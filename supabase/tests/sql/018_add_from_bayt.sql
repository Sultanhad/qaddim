-- What migration 018 promises. Run inside check-migrations.sh's throwaway database.
create function pg_temp.expect(what text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '% — got "%", wanted "%"', what, got, want; end if;
end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'bayt@test.local');
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000f1') on conflict (id) do nothing;
update public.profiles set auto_apply = true where id = '00000000-0000-0000-0000-0000000000f1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);

-- a Bayt-only posting: stored, saved for them, not queued
select public.add_job_from_page('https://www.bayt.com/en/saudi-arabia/jobs/product-manager-5123456/', 'Product Manager', 'Acme',
  'Riyadh, Saudi Arabia', 'Lead the product.', '2026-11-18', null);
select pg_temp.expect('stored with its place', (select title || '|' || city || '|' || country || '|' || source || '|' || url from public.jobs where source = 'bayt'),
  'Product Manager|riyadh|sa|bayt|https://www.bayt.com/en/saudi-arabia/jobs/product-manager-5123456/');
select pg_temp.expect('saved for them, not queued (applied to on Bayt)', (select a.status || '/' || coalesce(a.auto_status::text, '—') from public.applications a join public.jobs j on j.id = a.job_id where j.source = 'bayt'), 'saved/—');

-- a posting that sends applicants to Workable: applied to there, so queued
select public.add_job_from_page('https://bayt.com/ar/uae/jobs/analyst-7654321', 'Analyst', 'Beta', 'Dubai', '', 'not a date', 'https://apply.workable.com/beta/j/ABC123/');
select pg_temp.expect('the address is made one form', (select count(*)::text from public.jobs where canonical_url = 'https://www.bayt.com/ar/uae/jobs/analyst-7654321/'), '1');
select pg_temp.expect('its apply address is the hiring system', (select url from public.jobs where canonical_url like '%analyst-7654321/'), 'https://apply.workable.com/beta/j/ABC123/');
select pg_temp.expect('and it is queued', (select auto_status::text from public.applications a join public.jobs j on j.id = a.job_id where j.canonical_url like '%analyst-7654321/'), 'queued');

-- the same page twice: one job, one application
select public.add_job_from_page('https://www.bayt.com/en/saudi-arabia/jobs/product-manager-5123456', 'Product Manager', 'Acme', 'Riyadh', 'Lead the product.', null, null);
select pg_temp.expect('adding again changes nothing', (select count(*)::text from public.jobs where source = 'bayt') || '/' || (select count(*)::text from public.applications where user_id = '00000000-0000-0000-0000-0000000000f1'), '2/2');

-- any other address, or an apply link elsewhere, is refused or ignored
do $$ begin
  perform public.add_job_from_page('https://evil.example/en/saudi-arabia/jobs/x-1234567/', 'X', '', '', '', null, null);
  raise exception 'a non-Bayt page was accepted';
exception when raise_exception then if sqlerrm not like 'not a Bayt job page%' then raise; end if; end $$;
select public.add_job_from_page('https://www.bayt.com/en/qatar/jobs/engineer-1111111/', 'Engineer', 'Gamma', 'Doha', '', null, 'https://phishing.example/apply');
select pg_temp.expect('an apply link to anywhere else is not kept', (select url from public.jobs where canonical_url like '%engineer-1111111/'), 'https://www.bayt.com/en/qatar/jobs/engineer-1111111/');

-- not signed in
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  perform public.add_job_from_page('https://www.bayt.com/en/saudi-arabia/jobs/y-2222222/', 'Y', '', '', '', null, null);
  raise exception 'added without a sign-in';
exception when raise_exception then if sqlerrm not like 'not signed in%' then raise; end if; end $$;
