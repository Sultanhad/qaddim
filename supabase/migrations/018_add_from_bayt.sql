-- Jobs added by hand from Bayt.
--
-- Bayt does not allow its jobs to be read automatically (its robots.txt shuts the job search to
-- crawlers, and it turns automated readers away), so no worker reads it. A person reading a job
-- there in their own browser can add it: the extension reads the page they are looking at and
-- calls this function. One job, on their click, from a page they opened.
--
-- The job is stored like any other, with its Bayt address as its identity. If the posting
-- sends applicants to a hiring system qaddim applies on (Workable, Greenhouse, Lever, Ashby,
-- SmartRecruiters, Recruitee), that is where applying happens; otherwise it is applied to on
-- Bayt, by the person.
--
-- Nothing here removes or rewrites data. One function.

create or replace function public.add_job_from_page(
  p_url text, p_title text, p_company text, p_location text,
  p_description text, p_posted text, p_apply_url text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := auth.uid();
  v_canon  text;
  v_id     text;
  v_apply  text;
  v_loc    text := left(coalesce(p_location, ''), 300);
  v_low    text;
  v_city   text;
  v_country text;
  v_posted date;
  v_sends  boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- A Bayt job page, and nothing else: /en/saudi-arabia/jobs/some-title-1234567/
  if p_url is null or p_url !~ '^https://(www\.)?bayt\.com/(en|ar)/[a-z-]+/jobs/[^/?#]*-[0-9]{5,}/?$' then
    raise exception 'not a Bayt job page';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'the page gave no job title'; end if;

  v_canon := regexp_replace(lower(p_url), '^https://bayt', 'https://www.bayt');
  v_canon := regexp_replace(v_canon, '/?$', '/');
  v_id := 'b' || substr(md5(v_canon), 1, 12);

  -- Only an apply address on a hiring system qaddim applies on is kept apart from the page.
  v_apply := case
    when p_apply_url ~ '^https://(apply\.workable\.com|jobs\.lever\.co|jobs\.ashbyhq\.com|([a-z0-9-]+\.)?greenhouse\.io|(jobs|careers)\.smartrecruiters\.com|[a-z0-9-]+\.recruitee\.com)/'
      then left(p_apply_url, 1000)
    else v_canon end;

  -- Where: the country is in Bayt's address; the city in the location it shows.
  v_low := lower(v_loc);
  v_city := case
    when v_low ~ 'riyadh|الرياض' then 'riyadh' when v_low ~ 'jeddah|جدة' then 'jeddah'
    when v_low ~ 'dammam|الدمام' then 'dammam' when v_low ~ 'khobar|الخبر' then 'khobar'
    when v_low ~ 'makkah|mecca|مكة' then 'mecca' when v_low ~ 'madinah|medina|المدينة' then 'medina'
    when v_low ~ 'dubai|دبي' then 'dubai' when v_low ~ 'abu dhabi|أبوظبي' then 'abu dhabi'
    when v_low ~ 'doha|الدوحة' then 'doha' when v_low ~ 'manama|المنامة' then 'manama'
    when v_low ~ 'muscat|مسقط' then 'muscat' when v_low ~ 'cairo|القاهرة' then 'cairo'
    when v_low ~ 'amman|عمّان|عمان' then 'amman' else null end;
  v_country := case
    when v_canon ~ '/saudi-arabia/' then 'sa' when v_canon ~ '/uae/' then 'ae' when v_canon ~ '/qatar/' then 'qa'
    when v_canon ~ '/kuwait/' then 'kw' when v_canon ~ '/bahrain/' then 'bh' when v_canon ~ '/oman/' then 'om'
    when v_canon ~ '/egypt/' then 'eg' when v_canon ~ '/jordan/' then 'jo' else null end;
  begin v_posted := left(p_posted, 10)::date; exception when others then v_posted := null; end;

  insert into public.jobs (id, title, company, location, city, country, description, url, canonical_url,
                           source, source_type, source_job_id, published_at, first_seen, last_seen, is_open)
  values (v_id, left(trim(p_title), 200), left(coalesce(trim(p_company), ''), 120), v_loc, v_city, v_country,
          left(coalesce(p_description, ''), 20000), v_apply, v_canon,
          'bayt', 'board', substring(v_canon from '-([0-9]{5,})/$'), v_posted, now(), now(), true)
  on conflict (id) do update set
    title = excluded.title, company = excluded.company, location = excluded.location,
    city = excluded.city, country = excluded.country, description = excluded.description,
    url = excluded.url, last_seen = now(), is_open = true;

  -- Saved for them, and queued when something can apply for them there.
  select coalesce(p.auto_apply, false) into v_sends from public.profiles p where p.id = me;
  insert into public.applications (user_id, job_id, status, auto_status)
  values (me, v_id, 'saved', case when v_apply <> v_canon and v_sends then 'queued'::public.auto_apply_status else null end)
  on conflict (user_id, job_id) do nothing;

  return v_id;
end $$;
revoke all on function public.add_job_from_page(text, text, text, text, text, text, text) from public;
grant execute on function public.add_job_from_page(text, text, text, text, text, text, text) to authenticated;

comment on function public.add_job_from_page(text, text, text, text, text, text, text) is
  'Adds one Bayt job a signed-in person is looking at, and saves it for them. Bayt is never read automatically.';
