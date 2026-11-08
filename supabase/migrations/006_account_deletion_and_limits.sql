-- Two things the audit found broken or unguarded.
--
-- 1. Account deletion never worked. Supabase forbids DELETE on storage.objects from SQL
--    ("Use the Storage API instead"), so delete_my_account() raised on its first line, the
--    account survived, and the app signed the user out as if it were gone. The function now
--    does only what SQL can do — remove the auth user, which cascades to the profile and
--    applications — and the app removes the CV folder through the Storage API before calling it.
--
-- 2. Nothing checked the values the app writes. The anti-spam caps that make automatic
--    sending defensible were settable to anything by anyone with a session. These constraints
--    hold whatever the client does.

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- Bounds on what a profile may claim. Ranges are generous on purpose; they stop nonsense,
-- not edge cases.
alter table public.profiles
  drop constraint if exists profiles_daily_cap_range,
  drop constraint if exists profiles_min_score_range,
  drop constraint if exists profiles_years_range,
  drop constraint if exists profiles_graduation_year_range,
  drop constraint if exists profiles_text_lengths,
  drop constraint if exists profiles_lists_bounded,
  drop constraint if exists profiles_answers_bounded;

alter table public.profiles
  add constraint profiles_daily_cap_range      check (daily_cap between 1 and 40),
  add constraint profiles_min_score_range      check (min_score between 0 and 100),
  add constraint profiles_years_range          check (years_experience between 0 and 60),
  add constraint profiles_graduation_year_range check (graduation_year is null or graduation_year between 1950 and 2035),
  add constraint profiles_text_lengths check (
    coalesce(length(full_name), 0) <= 120 and
    coalesce(length(phone), 0) <= 40 and
    coalesce(length(email_for_applications), 0) <= 254 and
    coalesce(length(nationality), 0) <= 80 and
    coalesce(length(work_authorization), 0) <= 80 and
    coalesce(length(current_title), 0) <= 160 and
    coalesce(length(current_company), 0) <= 160 and
    coalesce(length(salary_expectation), 0) <= 80 and
    coalesce(length(current_salary), 0) <= 80 and
    coalesce(length(notice_period), 0) <= 80 and
    coalesce(length(education_degree), 0) <= 80 and
    coalesce(length(university), 0) <= 160 and
    coalesce(length(linkedin_url), 0) <= 300
  ),
  add constraint profiles_lists_bounded check (
    cardinality(roles) <= 20 and cardinality(skill_areas) <= 20 and cardinality(extra_skills) <= 60 and
    cardinality(cities) <= 30 and cardinality(countries) <= 12 and
    cardinality(exclude_companies) <= 100 and cardinality(exclude_title_words) <= 100
  ),
  -- the free-text answers the robot types into forms: bounded so a profile cannot carry megabytes
  add constraint profiles_answers_bounded check (answers is null or pg_column_size(answers) <= 65536);

alter table public.applications
  drop constraint if exists applications_notes_length,
  drop constraint if exists applications_attempts_range;
alter table public.applications
  add constraint applications_notes_length  check (coalesce(length(notes), 0) <= 4000),
  add constraint applications_attempts_range check (auto_attempts between 0 and 10);

-- The queries the app actually runs, indexed. (jobs_open_idx and the queue index exist already.)
create index if not exists applications_user_updated_idx on public.applications (user_id, updated_at desc);
create index if not exists applications_user_status_idx  on public.applications (user_id, status);
create index if not exists jobs_country_open_idx on public.jobs (country) where is_open;
create index if not exists jobs_published_idx    on public.jobs (published_at desc nulls last) where is_open;
