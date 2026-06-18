# AFIR-pikalaturiseuranta — core

Yksityiseen käyttöön tarkoitetun PWA:n UI-riippumaton ydin: AFIR-datan parseri,
domain-malli, statusluokittelu ja aggregointi. Suunnitelma:
[`AFIR_pikalaturiseuranta_sovellussuunnitelma.md`](AFIR_pikalaturiseuranta_sovellussuunnitelma.md).
Datan rakenne: [`docs/AFIR_datarakenne.md`](docs/AFIR_datarakenne.md).

## Rakenne

```
src/
  config.ts              fastChargerMinPowerKw = 50 (konfiguraatio), wattsToKw
  domain/types.ts        Location, Evse, Connector, EvseStatus, *Aggregate
  parser/
    status.ts            classifyStatus — keskitetty statusluokittelu (§8)
    locations.ts         parseLocations — AFIR GeoJSON -> domain (pikalaturisuodatus)
    statuses.ts          parseStatuses, statusIndex
  aggregate/aggregate.ts aggregateStation, aggregateNational
  index.ts               julkiset exportit
tests/                   31 testiä (parseri, statusluokittelu, aggregaatit) vasten fixtureja
fixtures/                operators / locations-sample / statuses-sample (statuses-all gitignored)
```

## Käyttö

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit (strict)
```

## Suunnitteluperiaatteet

- AFIR-raakadatan kenttäpolut elävät **vain** `parser/`-kansiossa; muu koodi käyttää domain-tyyppejä.
- Pikalaturin raja on konfiguraatio, ei maaginen luku.
- `maxElectricPower` on **watteina** — `wattsToKw` muuntaa; pikalaturikynnys 50000 W.
- Statusluokittelu kulkee aina `classifyStatus`-funktion läpi.

## Tietokanta (vaihe 3, valmis)

Supabase-skeema, RLS ja säilytyssiivous: [`supabase/`](supabase/) — ks.
[`supabase/README.md`](supabase/README.md). Core-moduulin aggregaattityypit vastaavat
`national_snapshots`- ja `latest_station_status`-tauluja.

## Collector (vaihe 4, valmis)

Ajastettu taustaprosessi: [`collector/`](collector/) — ks.
[`collector/README.md`](collector/README.md). GitHub Actions -workflow't
[`.github/workflows/`](.github/workflows/): status 5 min, metadata + cleanup päivittäin.
Datapolku todennettu livenä AFIR-dataa vasten.

## Seuraavat vaiheet (suunnitelma §17)

Vaihe 5 PWA-UI (Vite + React, lukee suoraan Supabasesta) · vaihe 6 ensimmäinen oma käyttö.
