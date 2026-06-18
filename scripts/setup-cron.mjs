// Tallentaa cronin header-salaisuuden yksityiseen tauluun (private.cron_config)
// JA tulostaa arvon, jotta sama asetetaan Edge Functionin secretiksi.
// Aja: node --env-file=.env scripts/setup-cron.mjs
//
// private-schemaa EI altisteta PostgREST-API:lle (vain public/graphql_public),
// joten salaisuus ei vuoda anon-/authenticated-rooleille. Cron lukee sen suoraan.
//
// Salaisuus luetaan CRON_SECRET-ympäristömuuttujasta. Jos puuttuu, generoidaan
// uusi ja lisätään .env:iin (gitignore). Sama arvo pitää asettaa funktiolle:
//   npx supabase secrets set CRON_SECRET=<arvo> --project-ref cwnrqwoijplfnspxzilq

import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

let secret = process.env.CRON_SECRET;
if (!secret) {
  secret = randomBytes(24).toString("hex");
  appendFileSync(".env", `\nCRON_SECRET=${secret}\n`);
  console.log("CRON_SECRET puuttui → generoitiin uusi ja lisättiin .env:iin.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("VIRHE: DATABASE_URL puuttuu .env:stä.");
  process.exit(1);
}

const caCertPath = process.env.SUPABASE_CA_CERT;
const client = new pg.Client({
  connectionString,
  ssl: caCertPath
    ? { ca: readFileSync(caCertPath, "utf-8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true },
});

async function main() {
  await client.connect();
  await client.query("create schema if not exists private");
  await client.query(`
    create table if not exists private.cron_config (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    )`);
  // Varmista ettei PostgREST-roolit pääse käsiksi (private ei ole exposed, mutta
  // revoketaan silti eksplisiittisesti).
  await client.query("revoke all on private.cron_config from anon, authenticated").catch(() => {});
  await client.query(
    `insert into private.cron_config (key, value, updated_at)
     values ('cron_secret', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [secret]
  );
  console.log("✓ cron_secret tallennettu private.cron_config-tauluun.");
  console.log("\nAseta SAMA arvo Edge Functionin secretiksi:");
  console.log(`  npx supabase secrets set CRON_SECRET=${secret} --project-ref cwnrqwoijplfnspxzilq`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => client.end());
