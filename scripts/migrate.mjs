// Ajaa supabase/migrations/*.sql -tiedostot järjestyksessä Supabase-kantaan.
// Ajetaan: node --env-file=.env scripts/migrate.mjs
//
// Lukee yhteysmerkkijonon DATABASE_URL-ympäristömuuttujasta (.env).
// Pitää kirjaa ajetuista migraatioista taulussa public.schema_migrations,
// joten ajon voi toistaa turvallisesti — vain uudet migraatiot ajetaan.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "VIRHE: DATABASE_URL puuttuu. Kopioi .env.example -> .env ja täytä yhteysmerkkijono.",
  );
  process.exit(1);
}

// TLS varmennetaan aina. Supabasen yhteydet käyttävät julkisen CA:n varmenteita,
// joten Noden oletusvarasto riittää yleensä sellaisenaan. Jos saat virheen
// "self-signed certificate in certificate chain", lataa Supabasen CA-varmenne
// (Dashboard → Project Settings → Database → SSL configuration) ja osoita siihen
// SUPABASE_CA_CERT-muuttujalla .env-tiedostossa.
const caCertPath = process.env.SUPABASE_CA_CERT;
const client = new pg.Client({
  connectionString,
  ssl: caCertPath
    ? { ca: readFileSync(caCertPath, "utf-8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true },
});

async function main() {
  await client.connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await client.query("select name from public.schema_migrations")).rows.map(
      (r) => r.name,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ohitetaan (jo ajettu): ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`→ ajetaan: ${file}`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations (name) values ($1)",
        [file],
      );
      await client.query("commit");
      ran++;
    } catch (err) {
      await client.query("rollback");
      console.error(`VIRHE migraatiossa ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log(
    ran === 0
      ? "Valmis. Ei uusia migraatioita."
      : `Valmis. Ajettiin ${ran} migraatio(ta).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.end());
