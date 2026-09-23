-- Täyssähköautojen määrä liikennekäytössä (Trendit: "Sähköautoja per pikalatauspiste").
--
-- LÄHDE
-- Traficomin avoin tilastorajapinta (PxWeb), taulukko "Liikennekäytössä olevat
-- ajoneuvot neljännesvuosittain":
--   https://trafi2.stat.fi/PXWeb/api/v1/fi/TraFi/Liikennekaytossa_olevat_ajoneuvot/040_kanta_tau_104.px
-- Tilanne neljänneksen viimeisenä päivänä, julkaistaan n. viikko neljänneksen
-- jälkeen. Alue = Manner-Suomi (MA1): Ahvenanmaalla on oma ajoneuvorekisteri,
-- eikä Traficomin tilasto sisällä sitä.
--
-- Collector (collector/vehicle-stock.ts) hakee koko aikasarjan joka yö ja
-- upserttaa sen, joten Traficomin jälkikäteiset korjaukset päivittyvät itsestään.
-- Rivejä on muutama sata eikä niitä siivota.
--
-- vehicle_class: Traficomin ajoneuvoluokkakoodi ('01' henkilöautot,
--                '02' pakettiautot). fuel: käyttövoimakoodi ('04' sähkö =
--                täyssähkö; ladattavat hybridit ovat omia koodejaan eikä niitä
--                kerätä).
create table if not exists public.vehicle_stock (
  quarter       text    not null,            -- "2026Q2"
  quarter_end   date    not null,            -- 2026-06-30
  vehicle_class text    not null,
  fuel          text    not null,
  vehicles      integer not null,
  fetched_at    timestamptz not null default now(),
  primary key (quarter, vehicle_class, fuel)
);

comment on table public.vehicle_stock is
  'Liikennekäytössä olevat ajoneuvot neljännesvuosittain (Traficom, Manner-Suomi).
   Kirjoitus vain collectorilla (service_role).';

-- Sama linja kuin muulla avoimella datalla: kirjautunut lukee, anon ei mitään.
alter table public.vehicle_stock enable row level security;

create policy "auth read vehicle_stock"
  on public.vehicle_stock for select to authenticated using (true);

notify pgrst, 'reload schema';
