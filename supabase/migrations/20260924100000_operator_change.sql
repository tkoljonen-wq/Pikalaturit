-- Operaattorin vaihto: sama fyysinen asema uudella operaattorilla ≠ uusi asema.
--
-- MIKSI
-- Syyskuussa 2026 Helen Oy:n latausasemia siirtyi Plugit Finlandille. Plugit
-- julkaisee ne AFIR:iin omilla asema- ja EVSE-tunnisteillaan, ja Helenin
-- versio katoaa aineistosta muutaman päivän sisällä (joskus molemmat ovat
-- hetken rinnakkain). Tunnisteiden perusteella new_fast_chargers näytti ne
-- uusina asemina, vaikka mitään ei rakennettu.
--
-- TUNNISTUS (vain kind = 'station' -riveille)
-- Edeltäjä = toinen asema lähes samassa pisteessä (≲ 50 m), joka oli
-- aineistossa jo ennen uutta ja jolla on pikalatureita, jotka joko
--   a) ovat kadonneet AFIR:sta (is_active = false) aikaisintaan 14 vrk ennen
--      uuden aseman ilmestymistä — vanha poistui, uusi tuli tilalle, tai
--   b) ovat yhä aktiivisia, mutta asemilla on sama nimi (toinen alkaa
--      toisella) — siirtymä kesken, vanha ei ole vielä poistunut.
-- Pelkkä sijainti ei riitä kohdassa b: samassa pisteessä on usein oikeasti
-- eri operaattoreiden asemia rinnakkain (esim. Tesla + ABC).
--
-- kind = 'operator_change', previous_operator / previous_name kertovat
-- edeltäjän. Muut rivit ennallaan; uudet sarakkeet lisätään loppuun, jotta
-- create or replace view onnistuu.

create or replace view public.new_fast_chargers
with (security_invoker = true) as
select
  case
    when b.added_day <> b.station_day then 'expansion'
    when p.operator_name is not null or p.name is not null then 'operator_change'
    else 'station'
  end as kind,
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
  b.added_day,
  p.operator_name as previous_operator,
  p.name          as previous_name
from (
  select
    l.id                                                        as location_id,
    l.name,
    l.city,
    l.address,
    l.operator_name,
    l.latitude,
    l.longitude,
    l.first_seen_at                                             as station_first_seen_at,
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
    l.first_seen_at, l.fast_evse_count,
    (l.first_fast_seen_at at time zone 'Europe/Helsinki')::date,
    (e.first_fast_seen_at at time zone 'Europe/Helsinki')::date
) b
left join lateral (
  select pl.operator_name, pl.name
  from public.locations pl
  where b.added_day = b.station_day
    and pl.id <> b.location_id
    -- ≈ 55 m pohjois–etelä, ≈ 50 m itä–länsi Suomen leveysasteilla
    and abs(pl.latitude  - b.latitude)  < 0.0005
    and abs(pl.longitude - b.longitude) < 0.001
    and pl.first_seen_at < b.station_first_seen_at
    and exists (
      select 1
      from public.evses pe
      where pe.location_id = pl.id
        and pe.is_fast_charger
        and (
          (not pe.is_active and pe.last_seen_at >= b.added_at - interval '14 days')
          or (
            pe.is_active
            and (starts_with(lower(pl.name), lower(b.name))
                 or starts_with(lower(b.name), lower(pl.name)))
          )
        )
    )
  order by abs(pl.latitude - b.latitude) + abs(pl.longitude - b.longitude)
  limit 1
) p on true;

comment on view public.new_fast_chargers is
  'Seurannan aikana ilmestyneet pikalaturit asemittain ja päivittäin.
   kind = station (uusi asema), expansion (laajennus olemassa olevalle) tai
   operator_change (olemassa oleva asema uudella operaattorilla/tunnisteella;
   previous_operator / previous_name = edeltäjä).
   added_count = erän koko, fast_total = aseman pikalatureita nyt.';

revoke all on public.new_fast_chargers from anon;
grant select on public.new_fast_chargers to authenticated;

notify pgrst, 'reload schema';
