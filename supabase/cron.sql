-- Schedule the ingest function every 15 minutes.
-- Run this AFTER deploying the function, and after setting the two values below.
--
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/ingest', 'ingest_url');
--   select vault.create_secret('<the INGEST_SECRET you set on the function>',        'ingest_secret');

select cron.unschedule('fursa-ingest') where exists (select 1 from cron.job where jobname = 'fursa-ingest');

select cron.schedule(
  'fursa-ingest',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_url'),
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Check it: select * from cron.job;  and  select * from cron.job_run_details order by start_time desc limit 5;
