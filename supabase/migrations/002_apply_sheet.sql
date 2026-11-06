-- Adds what an application form actually asks for, so a user types each answer once.
-- Safe to run on a database that already has 001 (schema.sql) applied.

alter table public.profiles
  add column if not exists email_for_applications text,
  add column if not exists nationality            text,
  add column if not exists work_authorization     text,
  add column if not exists requires_sponsorship   boolean,
  add column if not exists salary_expectation     text,   -- verbatim, e.g. "15,500 SAR monthly"
  add column if not exists current_salary         text,
  add column if not exists notice_period          text,
  add column if not exists current_company        text,
  add column if not exists current_title          text,
  add column if not exists linkedin_url           text,
  add column if not exists education_degree       text,
  add column if not exists university             text,
  add column if not exists graduation_year        int,
  -- Free-form answers to the questions employers keep asking: { "why this company": "…" }
  add column if not exists answers                jsonb not null default '{}'::jsonb;

comment on column public.profiles.answers is
  'Answers the user wrote themselves, keyed by the question. Nothing is ever generated into this column.';
