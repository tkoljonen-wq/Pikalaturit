# Supabase-käyttöönotto — askeleet

Tämä on jaettu **sinun tehtäviisi** (vaativat kirjautumisen Supabaseen) ja
**minun tehtäviini** (ajan puolestasi, kun `.env` on täytetty).

---

## SINUN TEHTÄVÄSI

### 1. Luo Supabase-projekti

1. Kirjaudu: <https://supabase.com/dashboard>
2. **New project**:
   - **Name:** esim. `afir-pikalaturit`
   - **Database Password:** luo vahva salasana ja **tallenna se** (tarvitaan kohdassa 3).
   - **Region:** valitse **EU** (esim. `Central EU (Frankfurt)` tai `North EU (Stockholm)`)
     — tietosuojan vuoksi data pidetään EU:ssa (GDPR).
   - **Plan:** Free.
3. Odota, että projekti on valmis (n. 2 min).

### 2. Rajaa kirjautuminen vain itsellesi (suunnitelma §14)

> Tee tämä kun olet ensin kirjautunut sovellukseen kerran (vaihe 5), tai jätä
> nyt väliin ja palaa tähän vaiheessa 5. Periaate:

- **Authentication → Providers → Google:** ota käyttöön ja täytä Google OAuth
  -tiedot (teen tarkat ohjeet vaiheessa 5), **tai** käytä aluksi sähköposti+salasana.
- **Authentication → Sign In / Up (tai Settings):** kun oma tilisi on luotu kerran,
  laita **"Allow new users to sign up" = OFF**. Tämän jälkeen muita tilejä ei synny.

### 3. Täytä `.env`

1. Kopioi `\.env.example` -> `\.env` (samaan kansioon).
2. **DATABASE_URL** — Dashboard → **Project Settings → Database → Connection string**:
   - Valitse välilehti **"Session pooler"** (toimii myös ilman IPv6:tta).
   - Kopioi URI ja korvaa `[YOUR-PASSWORD]` kohdan 1 salasanalla.
3. **SUPABASE_URL** ja **SUPABASE_SERVICE_ROLE_KEY** — Dashboard → **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `Project API keys → service_role` (paljasta ja kopioi) → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ service_role on täysi pääsyavain. Se menee vain `.env`-tiedostoon (gitignore)
     ja myöhemmin GitHub Actions -secretiin. **Älä jaa sitä äläkä liitä chattiin.**

### 4. Kerro minulle: "env valmis"

Sen jälkeen ajan migraatiot ja täytän kannan datalla (alla).

---

## MINUN TEHTÄVÄNI (ajan kun `.env` on valmis)

```bash
npm run db:migrate        # luo taulut, indeksit, RLS, retention-funktion
npm run collect:metadata  # hakee asema-/EVSE-metadatan AFIR:sta kantaan
npm run collect:status    # ensimmäinen statuskeruu + aggregaatit
```

Tarkistan tämän jälkeen, että:
- taulut ovat olemassa ja RLS päällä,
- `locations`/`evses` täyttyivät,
- `national_snapshots` sai ensimmäisen rivin,
- `collector_runs` näyttää onnistuneen ajon.

---

## MYÖHEMMIN (vaihe 5 / GitHub Actions)

- **GitHub-repo + secrets:** kun repo on olemassa, lisää Actions-secretit
  `SUPABASE_URL` ja `SUPABASE_SERVICE_ROLE_KEY` (Settings → Secrets and variables →
  Actions). Tällöin ajastetut workflow't alkavat kerätä dataa automaattisesti.
- **anon-avain** (`Project Settings → API → anon public`) tulee PWA:n frontend-konfiguraatioon.
