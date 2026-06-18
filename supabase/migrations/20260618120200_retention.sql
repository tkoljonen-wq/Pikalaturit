-- Säilytyssiivous (suunnitelma §9.7, §10)
--
--   * national_snapshots:           säilytetään pitkään (ei siivousta).
--   * latest_station_status:        vain viimeisin tila (ei kasva ajassa).
--   * watchlist_station_snapshots:  rajattu säilytysaika, oletus 180 päivää.
--   * collector_runs:               ajoloki, oletus 90 päivää.

create or replace function public.cleanup_old_snapshots(
  watchlist_retention_days integer default 180,
  collector_log_retention_days integer default 90
)
returns table (deleted_watchlist_rows bigint, deleted_collector_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  wl_deleted bigint;
  cr_deleted bigint;
begin
  delete from public.watchlist_station_snapshots
  where measured_at < now() - make_interval(days => watchlist_retention_days);
  get diagnostics wl_deleted = row_count;

  delete from public.collector_runs
  where created_at < now() - make_interval(days => collector_log_retention_days);
  get diagnostics cr_deleted = row_count;

  return query select wl_deleted, cr_deleted;
end;
$$;

comment on function public.cleanup_old_snapshots is
  'Poistaa vanhentuneet watchlist-snapshotit ja collector-lokit. Kutsu kerran/vrk
   (GitHub Actions tai pg_cron). Suoritetaan service_role/cron-oikeuksilla.';

-- Estä kaikki suora kutsuoikeus app-rooleilta — vain collector (service_role)
-- ja pg_cron saavat ajaa siivouksen.
revoke all on function public.cleanup_old_snapshots(integer, integer) from public, anon, authenticated;

-- ── Vaihtoehto A: ajasta pg_cronilla (jos pg_cron-laajennus käytössä) ──────
-- Supabasessa pg_cron on saatavilla. Ota käyttöön ja ajasta esim. klo 03:15:
--
--   create extension if not exists pg_cron;
--   select cron.schedule(
--     'cleanup-old-snapshots', '15 3 * * *',
--     $$ select public.cleanup_old_snapshots(); $$
--   );
--
-- ── Vaihtoehto B: GitHub Actions ──────────────────────────────────────────
-- Kutsu RPC:tä service_role-avaimella collectorin yhteydessä kerran vuorokaudessa:
--   POST {SUPABASE_URL}/rest/v1/rpc/cleanup_old_snapshots
