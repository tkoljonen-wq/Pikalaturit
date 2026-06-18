# Collector (vaihe 4)

Ajastettu taustaprosessi, joka hakee AFIR-datan, ajaa core-parserin/aggregoinnin ja
kirjoittaa Supabaseen `service_role`-avaimella (ohittaa RLS:n). Suunnitelma §11.

## Moodit

```bash
npm run collector -- status     # 5 min: statuskeruu + aggregaatit (oletus)
npm run collector -- metadata   # 1×/vrk: locations/evses/connectors + vanhentuneiden merkintä
npm run collector -- cleanup    # 1×/vrk: cleanup_old_snapshots() RPC
```

## Datapolku

```
status:   evses (kanta) ─┐
          AFIR statuses/all → parseStatuses → aggregateNationalFlat → national_snapshots
                                            → aggregateStationsFlat  → latest_station_status (upsert)
                                                                     → watchlist_station_snapshots
metadata: AFIR locations/all → parseLocations → upsert locations/evses/connectors
```

Statuskeruu ei hae 23 MB:n `locations/all`-dataa joka kierroksella, vaan lukee
pikalaturi-EVSE:t kannasta (metadatasynkronoinnin tuottamat rivit).

## Virheenkäsittely (§11.3)

- AFIR-haussa 429 ja verkkovirheet → maltillinen uudelleenyritys (backoff 1s/2s/4s).
- Jos haku epäonnistuu, ajo heittää → **ei kirjoiteta nollasnapshottia**, edellinen
  `latest_station_status` säilyy.
- Jokainen ajo (myös epäonnistunut) kirjataan `collector_runs`-tauluun.

## Ympäristömuuttujat (GitHub Actions secrets)

| Muuttuja | Selite |
|---|---|
| `SUPABASE_URL` | projektin URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role-avain — **vain** Actions-secret, ei frontendiin |

## Ajastus

`.github/workflows/collector-status.yml` (`*/5 * * * *`) ja
`.github/workflows/collector-metadata.yml` (`15 3 * * *`, metadata + cleanup).
GitHub Actions -cron ei ole tarkka 5 min; MVP:ssä hyväksytty.

## Todennettu livedataa vasten

End-to-end-savutesti (locations/all + statuses/all → parse → aggregate) tuottaa
johdonmukaisen valtakunnallisen luvun (esim. ~5600 pikalaturi-EVSE:tä, summat täsmäävät).
