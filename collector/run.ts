import { createServiceClient, unwrap } from "./db.js";
import { runStatusCollection } from "./status-run.js";
import { runMetadataSync } from "./metadata-sync.js";

type Mode = "status" | "metadata" | "cleanup";

function parseMode(argv: string[]): Mode {
  const arg = argv[2];
  if (arg === "metadata") return "metadata";
  if (arg === "cleanup") return "cleanup";
  if (arg === "status" || arg === undefined) return "status";
  throw new Error(
    `Tuntematon moodi: ${arg} (sallitut: status | metadata | cleanup)`,
  );
}

async function main() {
  const mode = parseMode(process.argv);
  const client = createServiceClient();
  const startedAt = new Date();

  // Siivous ei tarvitse collector_runs-lokitusta; se on oma kevyt operaationsa.
  if (mode === "cleanup") {
    const data = unwrap(await client.rpc("cleanup_old_snapshots"));
    console.log("[collector:cleanup] OK", data);
    return;
  }

  try {
    const result =
      mode === "metadata"
        ? await runMetadataSync(client)
        : await runStatusCollection(client);

    const finishedAt = new Date();
    unwrap(
      await client.from("collector_runs").insert({
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        success: true,
        status_count: "statusCount" in result ? result.statusCount : null,
        location_count: result.locationCount,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      }),
    );
    console.log(`[collector:${mode}] OK`, result);
  } catch (err) {
    const finishedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    // Kirjaa epäonnistunut ajo; ÄLÄ nollaa statuksia (§11.3).
    try {
      unwrap(
        await client.from("collector_runs").insert({
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          success: false,
          error_message: message,
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
        }),
      );
    } catch (logErr) {
      console.error("[collector] collector_runs-lokitus epäonnistui:", logErr);
    }
    console.error(`[collector:${mode}] VIRHE:`, message);
    process.exitCode = 1;
  }
}

void main();
