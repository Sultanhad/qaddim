-- job_sources learns Oracle Recruiting Cloud.
--
-- Most of the large Saudi employers keep their jobs there (Nahdi, Napco, ROSHN, Savola,
-- Mobily, Saudi Arabia Railways). The list of systems this table accepts is a check
-- constraint, and a board it does not know fails the worker's whole bookkeeping batch every
-- pass — exactly what happened with Workday until 012. Reading jobs never depended on it.
--
-- Nothing here removes or rewrites data.

alter table public.job_sources drop constraint if exists job_sources_system_check;
alter table public.job_sources add constraint job_sources_system_check
  check (system in ('ashby', 'lever', 'greenhouse', 'workable', 'smartrecruiters', 'recruitee', 'workday', 'oracle'));
