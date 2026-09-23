-- Uudet asemat (Trendit-välilehti): milloin asema ja sen ensimmäinen
-- pikalaturi ilmestyivät aineistoon.
--
-- MIKSI OMA KENTTÄ
-- AFIR-datassa EI ole aseman perustamis- tai avauspäivää. Ainoa päiväys on
-- `properties.modifiedAt` (locations.raw_updated_at), joka on "viimeksi
-- muokattu" ja päivittyy käytännössä joka synkronoinnissa: 23.9.2026 se oli
-- 1264 pikalatausasemalla 1281:stä alle vuorokauden vanha. Myöskään
-- locations.synced_at ei kelpaa — metadatasynkronointi ylikirjoittaa sen
-- joka ajolla. Aseman id on operaattorikohtainen eikä sisällä aikaleimaa
-- kuin osalla (n. kolmasosa on UUID v1 / .NET-tickejä, loput juoksevia
-- numeroita tai satunnaista hexaa), joten sitäkään ei voi käyttää.
--
-- Siksi ensiesiintyminen kirjataan itse. Takautuvaa tietoa ei ole saatavissa
-- mistään: ennen tätä migraatiota kannassa olleet asemat saavat
-- ensiesiintymisajaksi seurannan aloitushetken (vanhin synced_at), ja ne
-- rajataan "uusien" listalta pois (ks. näkymä new_fast_locations).
--
-- MIKSI KAKSI KENTTÄÄ
-- first_seen_at      = asema nähtiin ensi kertaa (myös pelkkä AC-asema).
-- first_fast_seen_at = asemalla nähtiin ensi kertaa vähintään yksi pikalaturi.
-- Nämä eroavat, kun olemassa olevalle AC-asemalle lisätään pikalaturi —
-- silloin "uusi pikalatausasema" syntyy vasta jälkimmäisenä hetkenä.

alter table public.locations
  add column if not exists first_seen_at      timestamptz,
  add column if not exists first_fast_seen_at timestamptz;

comment on column public.locations.first_seen_at is
  'Milloin asema nähtiin ensi kertaa metadatasynkronoinnissa. Ennen 23.9.2026
   kannassa olleilla = seurannan aloitushetki (ei todellinen perustamispäivä).';
comment on column public.locations.first_fast_seen_at is
  'Milloin asemalla nähtiin ensi kertaa pikalaturi (fast_evse_count > 0).
   null = asemalla ei ole koskaan ollut pikalaturia.';

-- Laturitason ensiesiintyminen: ei vielä käytössä käyttöliittymässä, mutta
-- kerätään nyt, koska takautuvasti sitä ei saa mistään. Tällä näkee myöhemmin
-- myös olemassa olevien asemien laajennukset (2 → 6 laturia).
alter table public.evses
  add column if not exists first_seen_at timestamptz;

comment on column public.evses.first_seen_at is
  'Milloin latauspiste nähtiin ensi kertaa. Ennen 23.9.2026 kannassa
   olleilla = seurannan aloitushetki.';

-- ── Takautuva täyttö: seurannan aloitushetki ───────────────────────────────
-- Vanhin synced_at = ensimmäinen metadatasynkronointi (18.6.2026). Kaikki
-- silloin kannassa olleet asemat saavat saman aikaleiman, jolloin näkymä
-- osaa rajata ne pois "uusista".
update public.locations
set first_seen_at = (select min(synced_at) from public.locations)
where first_seen_at is null;

update public.locations
set first_fast_seen_at = (select min(synced_at) from public.locations)
where first_fast_seen_at is null and coalesce(fast_evse_count, 0) > 0;

update public.evses
set first_seen_at = (select min(synced_at) from public.evses)
where first_seen_at is null;

-- ── Ylläpito: trigger täyttää kentät kerran, ei koskaan päivitä ────────────
-- Collector kirjoittaa upsertilla (INSERT ... ON CONFLICT DO UPDATE), eikä
-- lähetä näitä sarakkeita payloadissa → UPDATEssa NEW-arvo on sama kuin vanha
-- ja ehto `is null` pitää arvon paikallaan. ÄLÄ lisää näitä kenttiä
-- collectorin riveihin (collector/metadata-sync.ts), muuten ne nollautuisivat
-- joka synkronoinnissa.
--
-- Aikaleimaksi last_seen_at eli synkronointiajon kello — sama arvo kaikille
-- saman ajon riveille, jolloin yhdessä yössä ilmestyneet asemat saavat saman
-- päiväyksen.
create or replace function public.mark_first_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_seen_at is null then
    new.first_seen_at := coalesce(new.last_seen_at, now());
  end if;
  return new;
end;
$$;

create or replace function public.mark_location_first_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_seen_at is null then
    new.first_seen_at := coalesce(new.last_seen_at, now());
  end if;
  if new.first_fast_seen_at is null and coalesce(new.fast_evse_count, 0) > 0 then
    new.first_fast_seen_at := coalesce(new.last_seen_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists locations_first_seen on public.locations;
create trigger locations_first_seen
  before insert or update on public.locations
  for each row execute function public.mark_location_first_seen();

drop trigger if exists evses_first_seen on public.evses;
create trigger evses_first_seen
  before insert or update on public.evses
  for each row execute function public.mark_first_seen();

create index if not exists locations_first_fast_seen_idx
  on public.locations (first_fast_seen_at desc);

-- ── Näkymä: uudet pikalatausasemat ─────────────────────────────────────────
-- Yksi rivi per ASEMA (ei per laturi), uusin ensin. Seurannan alussa jo
-- olleet asemat rajataan pois vertaamalla vanhimpaan first_seen_at-arvoon:
-- ne kaikki jakavat saman aloitushetken, aidosti uudet ovat sitä myöhempiä.
--
-- security_invoker = true → locations-taulun RLS pätee (kirjautunut lukee,
-- anon ei mitään). Ks. 20260923090000_trend_views.sql.
create or replace view public.new_fast_locations
with (security_invoker = true) as
select
  l.id,
  l.name,
  l.city,
  l.address,
  l.operator_name,
  l.latitude,
  l.longitude,
  l.max_power_kw,
  l.fast_evse_count,
  l.total_evse_count,
  l.first_fast_seen_at,
  -- Päivä Suomen aikaa: yösynkronointi klo 6 Suomen aikaa osuisi UTC:ssä
  -- oikein, mutta päivärajaus tehdään silti paikallisessa ajassa kuten
  -- muissakin koostenäkymissä.
  (l.first_fast_seen_at at time zone 'Europe/Helsinki')::date as first_day
from public.locations l
where l.is_active
  and coalesce(l.fast_evse_count, 0) > 0
  and l.first_fast_seen_at > (select min(first_seen_at) from public.locations);

comment on view public.new_fast_locations is
  'Seurannan aikana ilmestyneet pikalatausasemat, yksi rivi per asema.
   first_day = päivä jona asemalla nähtiin ensimmäinen pikalaturi.';

revoke all on public.new_fast_locations from anon;
grant select on public.new_fast_locations to authenticated;

notify pgrst, 'reload schema';
