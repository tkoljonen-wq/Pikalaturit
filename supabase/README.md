# Supabase — tietokanta (vaihe 3)

Skeema, indeksit, RLS ja säilytyssiivous AFIR-pikalaturiseurannalle (suunnitelma §9, §14).

## Migraatiot

| Tiedosto | Sisältö |
|---|---|
| `20260618120000_initial_schema.sql` | taulut + indeksit (§9) |
| `20260618120100_rls_policies.sql` | Row Level Security (§14) |
| `20260618120200_retention.sql` | `cleanup_old_snapshots()` (§9.7) |

## Käyttöönotto

```bash
# Asenna Supabase CLI ja linkitä projekti
supabase link --project-ref <project-ref>

# Aja migraatiot etäkantaan
supabase db push
```

Tai liitä SQL suoraan Supabase Studion SQL-editoriin migraatioiden järjestyksessä.

## Pääsynrajaus (uhkamalli)

PWA lukee **suoraan Supabasesta**, joten anon-avain on julkinen (GitHub Pages -bundle).
RLS on ainoa todellinen suoja:

- **anon** — ei pääsyä mihinkään tauluun. Sovellukseen pääsee vain kirjautumalla.
- **authenticated** — lukee avoimen datan taulut (`locations`, `evses`, `connectors`,
  `latest_station_status`, `national_snapshots`, `collector_runs`,
  `watchlist_station_snapshots`) ja **oman** watchlistinsä (`user_id = auth.uid()`).
- **service_role** (collector / GitHub Actions) — ohittaa RLS:n, hoitaa kaiken kirjoituksen.
  Tätä avainta **ei koskaan** viedä frontendiin; vain GitHub Actions -secretsiin.

`auth.enable_signup = false` + sähköposti-/domain-rajaus varmistaa, ettei muita
tilejä synny (suunnitelma §14: "salli vain yksi oma tili").

## Roolit ja avaimet

| Avain | Missä | Oikeudet |
|---|---|---|
| `anon` | PWA-bundle (julkinen) | RLS:n alainen, vaatii kirjautumisen |
| `service_role` | GitHub Actions secret | ohittaa RLS:n, collectorin kirjoitukset |

## Datan kasvu ja siivous

- `national_snapshots` ~105 120 riviä/v — säilytetään pitkään.
- `latest_station_status` — vain viimeisin tila per asema, ei kasva ajassa.
- `watchlist_station_snapshots` — 180 pv (oletus), siivous `cleanup_old_snapshots()`.
- Aja siivous kerran/vrk: pg_cron tai GitHub Actions (ks. retention-migraation kommentit).
