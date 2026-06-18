import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateNationalFlat,
  aggregateStationsFlat,
  type AggregatableEvse,
} from "../src/aggregate/aggregate.js";
import { parseStatuses, statusIndex } from "../src/parser/statuses.js";
import { unwrap } from "./db.js";
import { fetchAllRows, writeInBatches } from "./rows.js";
import { fetchStatuses } from "./afir.js";

interface EvseRow {
  id: string;
  location_id: string;
  is_fast_charger: boolean | null;
}

/**
 * 5 minuutin statuskeruu (suunnitelma §11.2).
 * Virhetilanteessa heittää → ei kirjoiteta harhaanjohtavaa nollasnapshottia (§11.3).
 */
export async function runStatusCollection(
  client: SupabaseClient,
): Promise<{ statusCount: number; locationCount: number }> {
  // 1. EVSE-metadata kannasta (collector ei hae 23 MB:n locations/all -dataa joka kierroksella)
  const evseRows = await fetchAllRows<EvseRow>(
    client,
    "evses",
    "id, location_id, is_fast_charger",
  );
  const evses: AggregatableEvse[] = evseRows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    isFastCharger: r.is_fast_charger === true,
  }));

  // 2. AFIR-statukset
  const rawStatuses = await fetchStatuses();
  const statuses = parseStatuses(rawStatuses);
  const idx = statusIndex(statuses);

  // Datan ikä = kuinka tuore koko snapshot on (feedin modifiedAt), ei per-EVSE muutosaika.
  const feedModifiedAt = rawStatuses.modifiedAt ?? new Date().toISOString();
  const measuredAt = new Date().toISOString();
  const dataAgeSeconds = Math.max(
    0,
    Math.round((Date.parse(measuredAt) - Date.parse(feedModifiedAt)) / 1000),
  );

  // 3. Valtakunnallinen aggregaatti → national_snapshots
  const national = aggregateNationalFlat(evses, idx);
  unwrap(
    await client.from("national_snapshots").insert({
      measured_at: measuredAt,
      fast_total: national.fastTotal,
      fast_available: national.fastAvailable,
      fast_charging: national.fastCharging,
      fast_reserved: national.fastReserved,
      fast_blocked: national.fastBlocked,
      fast_out_of_order: national.fastOutOfOrder,
      fast_unknown: national.fastUnknown,
      fast_other: national.fastOther,
      occupancy_percent: national.occupancyPercent,
      unavailable_percent: national.unavailablePercent,
      data_source_updated_at: feedModifiedAt,
    }),
  );

  // 4. Asemakohtaiset aggregaatit → latest_station_status (upsert kaikille)
  const stations = aggregateStationsFlat(evses, idx);
  const stationRows = [...stations.values()].map((s) => ({
    location_id: s.locationId,
    fast_total: s.fastTotal,
    fast_available: s.fastAvailable,
    fast_charging: s.fastCharging,
    fast_reserved: s.fastReserved,
    fast_blocked: s.fastBlocked,
    fast_out_of_order: s.fastOutOfOrder,
    fast_unknown: s.fastUnknown,
    fast_other: s.fastOther,
    occupancy_percent: s.occupancyPercent,
    unavailable_percent: s.unavailablePercent,
    updated_at: feedModifiedAt,
    data_age_seconds: dataAgeSeconds,
  }));
  await writeInBatches(stationRows, 1000, async (batch) => {
    unwrap(
      await client
        .from("latest_station_status")
        .upsert(batch, { onConflict: "location_id" }),
    );
  });

  // 5. Watchlist-asemien historia → watchlist_station_snapshots
  const watchRows = unwrap(
    await client.from("watchlist").select("location_id"),
  ) as Array<{ location_id: string }>;
  const watchedIds = [...new Set(watchRows.map((w) => w.location_id))];
  const watchSnapshots = watchedIds
    .map((id) => stations.get(id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      location_id: s.locationId,
      measured_at: measuredAt,
      fast_total: s.fastTotal,
      fast_available: s.fastAvailable,
      fast_charging: s.fastCharging,
      fast_reserved: s.fastReserved,
      fast_blocked: s.fastBlocked,
      fast_out_of_order: s.fastOutOfOrder,
      fast_unknown: s.fastUnknown,
      fast_other: s.fastOther,
      occupancy_percent: s.occupancyPercent,
      unavailable_percent: s.unavailablePercent,
    }));
  if (watchSnapshots.length > 0) {
    unwrap(
      await client.from("watchlist_station_snapshots").insert(watchSnapshots),
    );
  }

  return { statusCount: statuses.length, locationCount: stationRows.length };
}
