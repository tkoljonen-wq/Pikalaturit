-- AFIR-pikalaturiseuranta — tietokantaskeema (suunnitelma §9)
-- Yksityiseen käyttöön. Lähdedata: Fintraffic / Digitraffic, CC BY 4.0.
--
-- Periaatteet:
--   * Vain valtakunnallinen aikasarja säilytetään pitkään.
--   * Kaikista asemista vain viimeisin tila (latest_station_status).
--   * Watchlist-asemien historia rajatusti (ks. retention-migraatio).
--   * Raakaa AFIR JSONia ei talleteta pysyvästi.

-- ─────────────────────────────────────────────────────────────────────────
-- Asemat ja kapasiteetti
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.locations (
  id                    text primary key,
  name                  text,
  operator_name         text,
  operator_country_code text,
  operator_party_id     text,
  latitude              double precision,
  longitude             double precision,
  address               text,
  city                  text,
  country               text,                 -- AFIR address.countryCode on 3-kirjaiminen ("FIN")
  max_power_kw          numeric,
  fast_evse_count       integer,
  total_evse_count      integer,
  raw_updated_at        timestamptz,          -- AFIR properties.modifiedAt
  -- Vanhentuneiden asemien merkintä (§11.1: älä poista heti puuttuvia)
  last_seen_at          timestamptz,
  is_active             boolean not null default true,
  synced_at             timestamptz not null default now()
);

comment on table public.locations is 'Latausasemat ja pikalaturikapasiteetti (Digitraffic AFIR, CC BY 4.0).';
comment on column public.locations.is_active is 'false = asema puuttui viimeisistä metadatahauista (ei poistettu heti).';

create table if not exists public.evses (
  id                    text primary key,     -- = AFIR statuses[].evseId
  location_id           text not null references public.locations(id) on delete cascade,
  evse_uid              text,
  evse_id               text,
  operator_country_code text,
  operator_party_id     text,
  max_power_kw          numeric,
  has_dc_connector      boolean,
  is_fast_charger       boolean,
  power_unknown         boolean,
  raw_updated_at        timestamptz,
  last_seen_at          timestamptz,
  is_active             boolean not null default true,
  synced_at             timestamptz not null default now()
);

create index if not exists evses_location_id_idx on public.evses (location_id);
create index if not exists evses_is_fast_charger_idx on public.evses (is_fast_charger) where is_fast_charger;

create table if not exists public.connectors (
  id                 text primary key,
  evse_id            text not null references public.evses(id) on delete cascade,
  connector_uid      text,
  standard           text,
  format             text,
  power_type         text,
  max_voltage        integer,
  max_amperage       integer,
  max_electric_power integer,                 -- watteina (AFIR maxElectricPower)
  max_power_kw       numeric
);

create index if not exists connectors_evse_id_idx on public.connectors (evse_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Viimeisin tila kaikille asemille (ei historiaa)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.latest_station_status (
  location_id        text primary key references public.locations(id) on delete cascade,
  fast_total         integer,
  fast_available     integer,
  fast_charging      integer,
  fast_reserved      integer,
  fast_blocked       integer,
  fast_out_of_order  integer,
  fast_unknown       integer,
  fast_other         integer,
  occupancy_percent  numeric,
  unavailable_percent numeric,
  updated_at         timestamptz,
  data_age_seconds   integer                  -- vanhin EVSE-statuksen ikä asemalla (§15)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Valtakunnallinen 5 min aikasarja (säilytetään pitkään)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.national_snapshots (
  id                     bigint generated always as identity primary key,
  measured_at            timestamptz not null,
  fast_total             integer not null,
  fast_available         integer not null,
  fast_charging          integer not null,
  fast_reserved          integer not null,
  fast_blocked           integer not null,
  fast_out_of_order      integer not null,
  fast_unknown           integer not null,
  fast_other             integer not null default 0,
  occupancy_percent      numeric,
  unavailable_percent    numeric,
  data_source_updated_at timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists national_snapshots_measured_at_idx
  on public.national_snapshots (measured_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Watchlist (käyttäjäkohtainen, yksityinen)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.watchlist (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid(),
  location_id  text not null references public.locations(id) on delete cascade,
  display_name text,
  sort_order   integer,
  created_at   timestamptz not null default now(),
  unique (user_id, location_id)
);

create index if not exists watchlist_user_id_idx on public.watchlist (user_id);

-- Watchlist-asemien 5 min historia (rajattu säilytysaika, ks. retention-migraatio)
create table if not exists public.watchlist_station_snapshots (
  id                  bigint generated always as identity primary key,
  location_id         text not null references public.locations(id) on delete cascade,
  measured_at         timestamptz not null,
  fast_total          integer not null,
  fast_available      integer not null,
  fast_charging       integer not null,
  fast_reserved       integer not null,
  fast_blocked        integer not null,
  fast_out_of_order   integer not null,
  fast_unknown        integer not null,
  fast_other          integer not null default 0,
  occupancy_percent   numeric,
  unavailable_percent numeric,
  created_at          timestamptz not null default now()
);

create index if not exists watchlist_station_snapshots_location_time_idx
  on public.watchlist_station_snapshots (location_id, measured_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Collectorin ajoloki
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.collector_runs (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null,
  finished_at    timestamptz,
  success        boolean not null,
  error_message  text,
  status_count   integer,
  location_count integer,
  duration_ms    integer,
  created_at     timestamptz not null default now()
);

create index if not exists collector_runs_started_at_idx
  on public.collector_runs (started_at desc);
