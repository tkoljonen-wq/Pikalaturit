# Edge Functions – käyttöönotto

## collector-status

5 min välein ajettava AFIR-statuskeruu, joka **korvaa GitHub Actions `*/5`
-cronin** (ei laukennut luotettavasti). Logiikka peilaa `collector/status-run.ts`.

Ajastus tehdään Supabasen sisällä: `pg_cron` ajaa joka 5. min ja `pg_net`
kutsuu tätä funktiota. Suojaus: `verify_jwt = false` (config.toml) + jaettu
salaisuus `x-cron-secret` -headerissa.

### Käyttöönotto (kertaalleen)

Tarvitset **Supabase personal access tokenin**:
https://supabase.com/dashboard/account/tokens

```bash
# 1) Salaisuus tietokantaan + .env:iin (jo tehty jos CRON_SECRET on .env:ssä)
node --env-file=.env scripts/setup-cron.mjs

# 2) Deployaa funktio (tarvitsee access tokenin)
export SUPABASE_ACCESS_TOKEN=<tokenisi>      # Windows PS: $env:SUPABASE_ACCESS_TOKEN="..."
npx supabase functions deploy collector-status --project-ref cwnrqwoijplfnspxzilq

# 3) Aseta sama CRON_SECRET funktion secretiksi (setup-cron.mjs tulosti komennon)
npx supabase secrets set CRON_SECRET=<arvo> --project-ref cwnrqwoijplfnspxzilq

# 4) Ota cron-ajastus käyttöön (luo pg_cron-jobin)
node --env-file=.env scripts/migrate.mjs
```

### Todennus

```sql
-- pg_cron-jobin tila ja viime ajot
select * from cron.job where jobname = 'collector-status-5min';
select * from cron.job_run_details order by start_time desc limit 5;
-- net.http_post -vastaukset (200 = ok)
select id, status_code, created from net._http_response order by id desc limit 5;
```

Tai: `node --env-file=.env scripts/check-data.mjs` → national_snapshots-rivien pitäisi
alkaa karttua 5 min välein.

### Manuaalinen testi (ilman cronia)

```bash
curl -i -X POST https://cwnrqwoijplfnspxzilq.supabase.co/functions/v1/collector-status \
  -H "x-cron-secret: <arvo>" -H "Content-Type: application/json" -d '{}'
```

### Huom: metadata + cleanup
`collector-metadata` (päivittäinen evses-sync + retention-siivous) on yhä GitHub
Actionsissa ja kärsii samasta schedule-epäluotettavuudesta. Päivätason cron on
selvästi luotettavampi kuin `*/5`, mutta jos sekään ei laukea, sama Edge Function
-malli kannattaa toteuttaa myös sille.
