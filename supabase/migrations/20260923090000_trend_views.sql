-- Trendinäkymät (Trendit-välilehti): valtakunnallisen datan päivä- ja
-- kuukausikoosteet.
--
-- MIKSI NÄKYMÄ EIKÄ LASKENTA SELAIMESSA
-- national_snapshots kasvaa ~52 500 riviä vuodessa (10 min väli) eikä sitä
-- siivota koskaan (ks. 20260618120200_retention.sql) — se on tarkoituksella
-- sovelluksen pitkä aikasarja. Monen vuoden trendin laskeminen selaimessa
-- tarkoittaisi satojen sivutettujen hakujen lataamista puhelimeen. Näkymä
-- palauttaa saman tiedon kymmeninä riveinä.
--
-- AIKAVYÖHYKE
-- Vuorokausi- ja kuukausirajat Europe/Helsinki -ajassa (myös kesäaika oikein).
-- UTC-rajaus siirtäisi kesällä klo 00–03 mittaukset edelliselle päivälle ja
-- vääristäisi sekä päivän huippulukeman että kuukausirajat.
--
-- OIKEUDET
-- security_invoker = true → näkymä ajetaan kutsujan oikeuksilla, joten
-- national_snapshots-taulun RLS pätee sellaisenaan (kirjautunut lukee, anon
-- ei näe mitään). Ilman tätä näkymä ajaisi omistajan (postgres) oikeuksilla
-- ja ohittaisi RLS:n — julkisessa bundlessa olevalla anon-avaimella pääsisi
-- lukemaan koko historian.
--
-- SUORITUSKYKY
-- Molemmat ovat tavallisia näkymiä: kysely lukee taulun läpi joka kerta.
-- 10 min datalla se on muutamia kymmeniä millisekunteja vuotta kohden, eli
-- riittää vuosiksi. Jos kysely joskus hidastuu, päivänäkymän voi vaihtaa
-- materialisoiduksi ja päivittää yöllisessä cronissa (cleanup-old-snapshots
-- vieressä) — kuukausinäkymä seuraa perässä sellaisenaan.

-- ── Päivätason kooste ───────────────────────────────────────────────────────
-- Yksi rivi per paikallinen vuorokausi. peak_charging = vuorokauden korkein
-- hetkellinen lataajamäärä; peak_at kertoo minkä mittauksen kohdalla se osui.
create or replace view public.national_daily_stats
with (security_invoker = true) as
select
  (measured_at at time zone 'Europe/Helsinki')::date                          as day,
  count(*)::int                                                               as samples,
  max(fast_charging)                                                          as peak_charging,
  -- Huippuhetken tiedot: järjestetään lataajamäärän mukaan ja otetaan 1. rivi.
  -- Tasatilanteessa (sama huippu useasti) valitaan vuorokauden ensimmäinen.
  (array_agg(measured_at       order by fast_charging desc, measured_at))[1]  as peak_at,
  (array_agg(fast_total        order by fast_charging desc, measured_at))[1]  as peak_fast_total,
  (array_agg(occupancy_percent order by fast_charging desc, measured_at))[1]  as peak_occupancy_percent,
  min(fast_charging)                                                          as min_charging,
  avg(fast_charging)::numeric(10, 1)                                          as avg_charging,
  max(fast_total)                                                             as max_fast_total
from public.national_snapshots
group by 1;

comment on view public.national_daily_stats is
  'Valtakunnallisen datan vuorokausikooste (Europe/Helsinki). peak_charging =
   vuorokauden korkein hetkellinen lataajamäärä. Käytetään Top 20 -ennätys-
   listaan ja kuukausinäkymän pohjana.';

-- ── Kuukausitason kooste ────────────────────────────────────────────────────
-- Päämittari avg_daily_peak = kuukauden päivähuippujen keskiarvo: montako
-- pikalaturia oli keskimäärin latauksessa vuorokauden vilkkaimpaan hetkeen.
-- Tämä ei riipu kuukauden pituudesta (toisin kuin summa), joten vajaa kuukausi
-- on vertailukelpoinen täyden kanssa jo kesken kuun.
create or replace view public.national_monthly_stats
with (security_invoker = true) as
select
  agg.month::date                                                          as month,
  -- Kuukauden pituus → käyttöliittymä tietää onko kuukausi vielä vajaa.
  extract(day from (agg.month + interval '1 month' - interval '1 day'))::int as days_in_month,
  agg.days,
  agg.samples,
  agg.avg_daily_peak,
  agg.peak_charging,
  agg.peak_day,
  agg.avg_charging,
  agg.max_fast_total
from (
  select
    date_trunc('month', day)                                             as month,
    count(*)::int                                                        as days,
    sum(samples)::bigint                                                 as samples,
    avg(peak_charging)::numeric(10, 1)                                   as avg_daily_peak,
    max(peak_charging)                                                   as peak_charging,
    (array_agg(day order by peak_charging desc, day))[1]                 as peak_day,
    -- Vuorokausikeskiarvot painotetaan mittausmäärällä, jotta vajaa
    -- ensimmäinen/viimeinen päivä ei saa täyden päivän painoa.
    (sum(avg_charging * samples) / nullif(sum(samples), 0))::numeric(10, 1) as avg_charging,
    max(max_fast_total)                                                  as max_fast_total
  from public.national_daily_stats
  group by 1
) agg;

comment on view public.national_monthly_stats is
  'Valtakunnallisen datan kuukausikooste (Europe/Helsinki). avg_daily_peak =
   kuukauden päivähuippujen keskiarvo, Trendit-välilehden päämittari.';

-- ── Oikeudet ────────────────────────────────────────────────────────────────
-- anon-rooli ei pääse mihinkään (sama linja kuin 20260618120100_rls_policies).
-- security_invoker estäisi rivit jo ilman tätäkin, mutta pidetään pääsy
-- eksplisiittisesti kiinni.
revoke all on public.national_daily_stats   from anon;
revoke all on public.national_monthly_stats from anon;
grant select on public.national_daily_stats   to authenticated;
grant select on public.national_monthly_stats to authenticated;

-- PostgREST-skeemavälimuistin päivitys, jotta näkymät näkyvät API:ssa heti
-- (ilman tätä ensimmäinen haku voi palauttaa PGRST205).
notify pgrst, 'reload schema';
