// Tallentaa GitHub-tokenin yksityiseen tauluun (private.cron_config), jotta
// metadata-cron (20260619080000_cron_metadata_cleanup.sql) voi käynnistää
// collector-metadata-workflow'n GitHubin workflow_dispatch-API:n kautta.
// Aja: node --env-file=.env scripts/setup-metadata-cron.mjs
//
// Token luetaan GITHUB_DISPATCH_TOKEN-ympäristömuuttujasta (.env). Luo se
// GitHubissa: Settings → Developer settings → Fine-grained tokens →
//   Repository access: vain tkoljonen-wq/Pikalaturit
//   Permissions: Actions = Read and write  (workflow_dispatch vaatii tämän)
// private-schemaa EI altisteta PostgREST-API:lle, joten token ei vuoda
// anon-/authenticated-rooleille. Cron lukee sen suoraan.

import { readFileSync } from "node:fs";
import pg from "pg";

const token = process.env.GITHUB_DISPATCH_TOKEN;
if (!token) {
  console.error(
    "VIRHE: GITHUB_DISPATCH_TOKEN puuttuu .env:stä.\n" +
      "Luo fine-grained PAT (Actions: Read and write, repo Pikalaturit) ja lisää .env:iin:\n" +
      "  GITHUB_DISPATCH_TOKEN=github_pat_..."
  );
  process.exit(1);
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
  await client.query("revoke all on private.cron_config from anon, authenticated").catch(() => {});
  await client.query(
    `insert into private.cron_config (key, value, updated_at)
     values ('github_token', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [token]
  );
  console.log("✓ github_token tallennettu private.cron_config-tauluun.");
  console.log("Metadata-cron voi nyt käynnistää collector-metadata-workflow'n klo 03:15 UTC.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => client.end());
