-- Historian korjaus: AFIR:sta poistuneet pikalaturit pois national_snapshotsista.
--
-- MIKSI
-- Metadatasynkronointi merkitsee aineistosta kadonneet EVSE:t is_active=false,
-- mutta statuskeruu (collector-status Edge Function) luki evses-taulun
-- suodattamatta, joten poistuneet laturit jäivät laskuun pysyvästi. Niillä ei
-- ole statusta, joten ne kirjautuivat "tuntemattomiksi". Virhe paisui
-- syyskuussa 2026, kun Helenin asemia siirtyi Plugitille uusilla
-- tunnisteilla: 24.9. fast_total oli ~239 laturia liian suuri. Keruu korjattiin
-- samana päivänä (ks. collector-status/index.ts); tämä korjaa sitä edeltävät rivit.
--
-- MENETELMÄ
-- EVSE on "haamu" siitä synkronoinnista alkaen, jossa se ensimmäisen kerran
-- puuttui: synkronointi ajetaan joka yö klo 03:15 UTC, joten katoamishetki =
-- seuraava 03:15 UTC viimeisen havainnon (last_seen_at) jälkeen. Jokaisesta
-- korjattavasta rivistä vähennetään siihen mennessä kadonneet pikalaturit
-- fast_totalista ja fast_unknownista, ja prosentit lasketaan uudelleen.
-- Kaikki 249 poistunutta EVSE:tä puuttuivat statusfeedistä (tarkistettu
-- 24.9.2026) → ne olivat aina "tuntemattomia"; kuivaharjoituksessa yksikään
-- fast_unknown ei mennyt negatiiviseksi.
--
-- RAJOITUKSET
-- Poistuneet ja myöhemmin palanneet EVSE:t ovat nyt aktiivisia, joten niiden
-- poissaolojaksoa ei voi tunnistaa (vaikutus arviolta muutamia latureita).
--
-- Rajaus: vain ennen korjatun keruun käyttöönottoa (Edge Function deploy
-- 2026-09-24 09:55:38 UTC; ensimmäinen korjattu mittaus 10:00:04) mitatut rivit. Alkuperäiset
-- arvot talteen private-skeemaan, jos korjaus pitää perua.

create table if not exists private.national_snapshots_pre_ghostfix as
select id, fast_total, fast_unknown, occupancy_percent, unavailable_percent
from public.national_snapshots
where false;

with g as (
  select
    date_trunc('day', last_seen_at - interval '3 hours 15 minutes')
      + interval '1 day 3 hours 15 minutes' as gone_at,
    count(*) as n
  from public.evses
  where is_fast_charger and not is_active
  group by 1
),
cum as (
  select gone_at, sum(n) over (order by gone_at)::int as ghosts from g
),
fix as (
  select s.id,
         (select c.ghosts from cum c where c.gone_at <= s.measured_at
          order by c.gone_at desc limit 1) as ghosts
  from public.national_snapshots s
  where s.measured_at < timestamptz '2026-09-24T09:55:38Z'
),
saved as (
  insert into private.national_snapshots_pre_ghostfix
  select s.id, s.fast_total, s.fast_unknown, s.occupancy_percent, s.unavailable_percent
  from public.national_snapshots s
  join fix f on f.id = s.id
  where f.ghosts > 0
  returning id
)
update public.national_snapshots s
set fast_total   = s.fast_total - f.ghosts,
    fast_unknown = s.fast_unknown - f.ghosts,
    occupancy_percent = case when s.fast_total - f.ghosts = 0 then null
      else s.fast_charging * 100.0 / (s.fast_total - f.ghosts) end,
    unavailable_percent = case when s.fast_total - f.ghosts = 0 then null
      else (s.fast_charging + s.fast_reserved + s.fast_blocked
            + s.fast_out_of_order + s.fast_unknown - f.ghosts) * 100.0
           / (s.fast_total - f.ghosts) end
from fix f
where f.id = s.id
  and f.ghosts > 0
  and f.id in (select id from saved);
