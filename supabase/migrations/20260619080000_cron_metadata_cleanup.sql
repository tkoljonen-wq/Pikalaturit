-- Päivittäinen metadata-keruu ja säilytyssiivous Supabasen omalla cronilla.
-- Korvaa GitHub Actionsin `schedule`-laukaisun, joka ei laukennut luotettavasti
-- (collector-metadata.yml ei ollut ajanut kertaakaan). Vrt. statuskeruu:
-- 20260618130000_cron_status.sql.
--
--   * cleanup:  puhdasta SQL:ää (public.cleanup_old_snapshots) → pg_cron ajaa
--               suoraan, ei ulkoisia riippuvuuksia.
--   * metadata: raskas Node-keruu (23 MB locations/all + parsinta) pidetään
--               testatussa Node-collectorissa. pg_cron käynnistää sen GitHubin
--               workflow_dispatch-API:n kautta (pg_net) → ajo tapahtuu GitHub
--               Actions -runnerilla, mutta laukaisu tulee luotettavasta cronista.
--
-- HUOM: GitHub-tokenia EI kirjoiteta tähän committoitavaan tiedostoon. Cron lukee
-- sen private.cron_config-taulusta, johon arvo asetetaan erikseen .env:stä:
--   node --env-file=.env scripts/setup-metadata-cron.mjs

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Salaisuustaulu on luotu jo cron_status-migraatiossa; varmistetaan idempotentisti.
create schema if not exists private;
create table if not exists private.cron_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.cron_config from anon, authenticated;

-- ── Säilytyssiivous: päivittäin klo 03:10 UTC ─────────────────────────────────
do $$
begin
  perform cron.unschedule('cleanup-old-snapshots');
exception
  when others then null; -- jobia ei ollut, ohitetaan
end $$;

select cron.schedule(
  'cleanup-old-snapshots',
  '10 3 * * *',
  $$ select public.cleanup_old_snapshots(); $$
);

-- ── Metadata: päivittäin klo 03:15 UTC, käynnistä GitHub Actions ──────────────
do $$
begin
  perform cron.unschedule('collector-metadata-daily');
exception
  when others then null;
end $$;

select cron.schedule(
  'collector-metadata-daily',
  '15 3 * * *',
  $job$
  select net.http_post(
    url := 'https://api.github.com/repos/tkoljonen-wq/Pikalaturit/actions/workflows/collector-metadata.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from private.cron_config where key = 'github_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      -- GitHub API vaatii User-Agentin tai palauttaa 403.
      'User-Agent', 'Pikalaturit-cron',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 30000
  );
  $job$
);
