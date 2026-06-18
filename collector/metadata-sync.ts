import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseLocations } from "../src/parser/locations.js";
import type { Location } from "../src/domain/types.js";
import { unwrap } from "./db.js";
import { writeInBatches } from "./rows.js";
import { fetchLocations } from "./afir.js";

/**
 * Poistaa duplikaattiavaimet (säilyttää viimeisen). AFIR-datassa esiintyy
 * samoja location-, EVSE- ja connector-id:itä useammin kuin kerran, mikä
 * kaataisi upsertin (ON CONFLICT ... cannot affect row a second time).
 */
function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

function locationRow(l: Location, seenAt: string) {
  const fastCount = l.evses.filter((e) => e.isFastCharger).length;
  const maxPowerKw = l.evses.reduce<number | null>((acc, e) => {
    if (e.maxPowerKw == null) return acc;
    return acc == null ? e.maxPowerKw : Math.max(acc, e.maxPowerKw);
  }, null);
  return {
    id: l.id,
    name: l.name,
    operator_name: l.operatorName,
    operator_country_code: l.operatorCountryCode,
    operator_party_id: l.operatorPartyId,
    latitude: l.latitude,
    longitude: l.longitude,
    address: l.address,
    city: l.city,
    country: l.country,
    max_power_kw: maxPowerKw,
    fast_evse_count: fastCount,
    total_evse_count: l.evses.length,
    raw_updated_at: l.modifiedAt,
    last_seen_at: seenAt,
    is_active: true,
    synced_at: seenAt,
  };
}

/**
 * Metadatasynkronointi (suunnitelma §11.1). Aja esim. kerran vuorokaudessa.
 * Päivittää locations / evses / connectors ja merkitsee puuttuvat asemat
 * vanhentuneiksi sen sijaan että poistaisi ne heti.
 */
export async function runMetadataSync(
  client: SupabaseClient,
): Promise<{ locationCount: number; evseCount: number }> {
  const seenAt = new Date().toISOString();
  const raw = await fetchLocations();
  const locations = parseLocations(raw, DEFAULT_CONFIG);

  const locationRows = dedupeBy(
    locations.map((l) => locationRow(l, seenAt)),
    (r) => r.id,
  );

  const evseRows = dedupeBy(
    locations.flatMap((l) =>
    l.evses.map((e) => ({
      id: e.id,
      location_id: l.id,
      operator_country_code: e.operatorCountryCode,
      operator_party_id: e.operatorPartyId,
      max_power_kw: e.maxPowerKw,
      has_dc_connector: e.hasDcConnector,
      is_fast_charger: e.isFastCharger,
      power_unknown: e.powerUnknown,
      last_seen_at: seenAt,
      is_active: true,
      synced_at: seenAt,
    })),
    ),
    (r) => r.id,
  );
  const evseIds = new Set(evseRows.map((e) => e.id));

  const connectorRows = dedupeBy(
    locations.flatMap((l) =>
    l.evses.flatMap((e) =>
      e.connectors.map((c, i) => ({
        id: `${e.id}#${i}`, // AFIR ei anna liittimelle id:tä → synteettinen
        evse_id: e.id,
        standard: c.standard,
        format: c.format,
        power_type: c.powerType,
        max_voltage: c.maxVoltage,
        max_amperage: c.maxAmperage,
        max_electric_power: c.maxElectricPowerW,
        max_power_kw: c.maxPowerKw,
      })),
    ),
    ).filter((c) => evseIds.has(c.evse_id)), // vain dedupatuille EVSE:ille jääneet
    (r) => r.id,
  );

  // Kirjoitusjärjestys FK-riippuvuuksien mukaan: locations → evses → connectors.
  await writeInBatches(locationRows, 500, async (b) => {
    unwrap(await client.from("locations").upsert(b, { onConflict: "id" }));
  });
  await writeInBatches(evseRows, 500, async (b) => {
    unwrap(await client.from("evses").upsert(b, { onConflict: "id" }));
  });
  await writeInBatches(connectorRows, 500, async (b) => {
    unwrap(await client.from("connectors").upsert(b, { onConflict: "id" }));
  });

  // Merkitse vanhentuneiksi ne, joita ei nähty tässä haussa (§11.1 kohta 5).
  unwrap(
    await client
      .from("evses")
      .update({ is_active: false })
      .lt("last_seen_at", seenAt),
  );
  unwrap(
    await client
      .from("locations")
      .update({ is_active: false })
      .lt("last_seen_at", seenAt),
  );

  return { locationCount: locationRows.length, evseCount: evseRows.length };
}
