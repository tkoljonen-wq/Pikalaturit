-- Laajennukset: olemassa oleville asemille lisätyt pikalaturit.
--
-- 20260923120000_first_seen.sql toi asematason ensiesiintymisen ("uusi
-- asema"). Tämä täydentää saman laturitasolle, jolloin näkyy myös se, kun
-- olemassa oleva asema kasvaa 2 → 6 laturiin.
--
-- MIKSI OMA KENTTÄ first_fast_seen_at MYÖS EVSE:LLE
-- evses.first_seen_at kertoo milloin latauspiste nähtiin ensi kertaa, mutta
-- piste voi muuttua pikalaturiksi myöhemmin (AC-piste vaihdetaan DC ≥ 50 kW:n
-- laitteeksi samalla id:llä). Silloin "uusi pikalaturi" syntyy vasta siinä
-- hetkessä, ei pisteen ensiesiintymisessä.

alter table public.evses
  add column if not exists first_fast_seen_at timestamptz;

comment on column public.evses.first_fast_seen_at is
  'Milloin latauspiste nähtiin ensi kertaa pikalaturina (is_fast_charger).
   null = piste ei ole koskaan ollut pikalaturi.';

-- Takautuva täyttö: nykyisille pikalatureille sama hetki kuin pisteen
-- ensiesiintyminen. Ennen 23.9.2026 tapahtuneita AC → DC -vaihtoja ei voi
-- erottaa mitenkään, joten ne eivät näy laajennuksina.
update public.evses
set first_fast_seen_at = first_seen_at
where first_fast_seen_at is null and is_fast_charger;

-- Trigger täydentyy: sama kertatäyttölogiikka kuin locationsissa. Collector
-- ei lähetä näitä kenttiä upsertin payloadissa, joten arvo säilyy.
create or replace function public.mark_first_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_seen_at is null then
    new.first_seen_at := coalesce(new.last_seen_at, now());
  end if;
  if new.first_fast_seen_at is null and new.is_fast_charger then
    new.first_fast_seen_at := coalesce(new.last_seen_at, now());
  end if;
  return new;
end;
$$;

comment on function public.mark_first_seen() is
  'evses-taulun trigger: täyttää first_seen_at / first_fast_seen_at kerran.';

create index if not exists evses_first_fast_seen_idx
  on public.evses (first_fast_seen_at desc)
  where is_fast_charger;

-- ── Näkymä: uudet pikalaturit (uudet asemat + laajennukset) ────────────────
-- Yksi rivi = yhdelle ASEMALLE yhtenä päivänä ilmestynyt erä pikalatureita.
-- Monta laturia samalla asemalla = yksi rivi, ei riviä per laturi.
--
--   kind = 'station'   erä osuu aseman ensimmäiseen pikalaturipäivään
--                      → koko asema on uusi (tai AC-asemasta tuli pikalataus-
--                        asema).
--   kind = 'expansion' erä ilmestyi myöhempänä päivänä → laajennus.
--
-- Seurannan alussa (18.6.2026) jo olleet laturit rajataan pois vertaamalla
-- vanhimpaan ensiesiintymiseen: ne kaikki jakavat saman aloitushetken.
--
-- Korvaa 20260923120000_first_seen.sql:n new_fast_locations-näkymän, joka
-- tunsi vain uudet asemat.
drop view if exists public.new_fast_locations;

create or replace view public.new_fast_chargers
with (security_invoker = true) as
select
  case when b.added_day = b.station_day then 'station' else 'expansion' end as kind,
  b.location_id,
  b.name,
  b.city,
  b.address,
  b.operator_name,
  b.latitude,
  b.longitude,
  b.fast_total,
  b.added_count,
  b.added_max_power_kw,
  b.added_at,
  b.added_day
from (
  select
    l.id                                                        as location_id,
    l.name,
    l.city,
    l.address,
    l.operator_name,
    l.latitude,
    l.longitude,
    -- Aseman pikalatureiden määrä NYT (ei erän kokoinen).
    l.fast_evse_count                                           as fast_total,
    (l.first_fast_seen_at at time zone 'Europe/Helsinki')::date  as station_day,
    (e.first_fast_seen_at at time zone 'Europe/Helsinki')::date  as added_day,
    count(*)::int                                               as added_count,
    max(e.max_power_kw)                                         as added_max_power_kw,
    -- Päivän sisällä voi olla useampi synkronointi (esim. käsin ajettu);
    -- ne niputetaan samaksi eräksi.
    max(e.first_fast_seen_at)                                   as added_at
  from public.evses e
  join public.locations l on l.id = e.location_id
  where e.is_active
    and l.is_active
    and e.is_fast_charger
    and e.first_fast_seen_at > (select min(first_seen_at) from public.locations)
  group by
    l.id, l.name, l.city, l.address, l.operator_name, l.latitude, l.longitude,
    l.fast_evse_count,
    (l.first_fast_seen_at at time zone 'Europe/Helsinki')::date,
    (e.first_fast_seen_at at time zone 'Europe/Helsinki')::date
) b;

comment on view public.new_fast_chargers is
  'Seurannan aikana ilmestyneet pikalaturit asemittain ja päivittäin.
   kind = station (uusi asema) tai expansion (laajennus olemassa olevalle).
   added_count = erän koko, fast_total = aseman pikalatureita nyt.';

revoke all on public.new_fast_chargers from anon;
grant select on public.new_fast_chargers to authenticated;

notify pgrst, 'reload schema';
