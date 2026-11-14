-- job_sources learns iCIMS — Riyadh Air's four portals (corporate, cabin crew, pilots,
-- engineering). Same shape as 014; reading jobs never depended on it.
--
-- Nothing here removes or rewrites data.

alter table public.job_sources drop constraint if exists job_sources_system_check;
alter table public.job_sources add constraint job_sources_system_check
  check (system in ('ashby', 'lever', 'greenhouse', 'workable', 'smartrecruiters', 'recruitee', 'workday', 'oracle', 'icims'));
