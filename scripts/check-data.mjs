// Kertaluontoinen tarkistus: onko data alkanut kertyä automaattisesti?
// Aja: node --env-file=.env scripts/check-data.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const ca = process.env.SUPABASE_CA_CERT;
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: ca
    ? { ca: readFileSync(ca, "utf-8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true },
});

const q = (sql) => client.query(sql).then((r) => r.rows);

async function main() {
  await client.connect();

  const ns = (
    await q(`
    select count(*)::int n,
           min(measured_at) first_at,
           max(measured_at) last_at,
           count(*) filter (where measured_at > now() - interval '1 hour')::int last_1h,
           count(*) filter (where measured_at > now() - interval '24 hours')::int last_24h
    from public.national_snapshots`)
  )[0];

  console.log("=== national_snapshots ===");
  console.log(`rivejä yhteensä:      ${ns.n}`);
  console.log(`ensimmäinen mittaus:  ${ns.first_at?.toISOString?.() ?? ns.first_at}`);
  console.log(`viimeisin mittaus:    ${ns.last_at?.toISOString?.() ?? ns.last_at}`);
  console.log(`viim. 1 h:            ${ns.last_1h} riviä`);
  console.log(`viim. 24 h:           ${ns.last_24h} riviä`);

  console.log("\n=== viimeiset 12 snapshottia (väli = collectorin todellinen tahti) ===");
  const recent = await q(`
    select measured_at, fast_charging, fast_available, fast_total
    from public.national_snapshots
    order by measured_at desc limit 12`);
  let prev = null;
  for (const r of recent) {
    const t = new Date(r.measured_at);
    const gap = prev ? Math.round((prev - t) / 1000) : null;
    console.log(
      `${t.toISOString()}  latauksessa=${r.fast_charging}  vapaana=${r.fast_available}  ${
        gap != null ? `(+${Math.round(gap / 60)} min ed.)` : ""
      }`
    );
    prev = t;
  }

  console.log("\n=== collector_runs (10 viimeisintä ajoa) ===");
  try {
    const runs = await q(`select * from public.collector_runs order by id desc limit 10`);
    if (!runs.length) console.log("(ei ajorivejä)");
    for (const r of runs) console.log(JSON.stringify(r));
  } catch (e) {
    console.log("collector_runs-kysely epäonnistui:", e.message);
  }

  console.log("\n=== latest_station_status tuoreus ===");
  const lss = (
    await q(`select max(updated_at) max_updated, count(*)::int n from public.latest_station_status`)
  )[0];
  console.log(`rivejä: ${lss.n}, tuorein updated_at: ${lss.max_updated?.toISOString?.() ?? lss.max_updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => client.end());
