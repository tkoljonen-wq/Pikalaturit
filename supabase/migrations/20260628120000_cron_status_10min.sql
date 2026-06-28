-- Muutetaan statuskeruun ajastusväli 5 min → 10 min.
-- Korvaa migraation 20260618130000_cron_status.sql ajastuksen. Sama Edge Function
-- (collector-status), vain cron-aikataulu harvennetaan. Idempotentti: poistaa sekä
-- vanhan (5min) että uuden (10min) nimisen jobin ennen uudelleenajastusta.

do $$
begin
  perform cron.unschedule('collector-status-5min');
exception
  when others then null; -- jobia ei ollut, ohitetaan
end $$;

do $$
begin
  perform cron.unschedule('collector-status-10min');
exception
  when others then null; -- jobia ei ollut, ohitetaan
end $$;

select cron.schedule(
  'collector-status-10min',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://cwnrqwoijplfnspxzilq.supabase.co/functions/v1/collector-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from private.cron_config where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
