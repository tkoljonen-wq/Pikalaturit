-- Ajastettu statuskeruu Supabasen SISÄLLÄ (pg_cron + pg_net), 5 min välein.
-- Korvaa GitHub Actions */5 -cronin, joka ei laukennut luotettavasti uudella
-- repolla. Kutsuu Edge Functionia collector-status.
--
-- HUOM: header-salaisuutta (x-cron-secret) EI kirjoiteta tähän committoitavaan
-- tiedostoon. Cron lukee sen tietokannan asetuksesta app.cron_secret, joka
-- asetetaan erikseen .env:stä: node --env-file=.env scripts/setup-cron.mjs

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Header-salaisuus säilytetään yksityisessä schemassa (ei PostgREST-API:ssa).
-- Arvo asetetaan erikseen: node --env-file=.env scripts/setup-cron.mjs
create schema if not exists private;
create table if not exists private.cron_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.cron_config from anon, authenticated;

-- Poista vanha ajastus jos olemassa (idempotentti).
do $$
begin
  perform cron.unschedule('collector-status-5min');
exception
  when others then null; -- jobia ei ollut, ohitetaan
end $$;

select cron.schedule(
  'collector-status-5min',
  '*/5 * * * *',
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
