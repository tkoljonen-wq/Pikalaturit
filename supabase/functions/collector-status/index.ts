// Supabase Edge Function: AFIR-statuskeruu (korvaa GitHub Actions */5 cronin,
// joka ei laukennut luotettavasti). Ajetaan Supabasen omalla cronilla (pg_cron +
// pg_net) 5 min välein, ks. migraatio 20260618130000_cron_status.sql.
//
// Logiikka peilaa collector/status-run.ts + src/parser/status.ts + src/aggregate.
// Itsenäinen (Deno) — ei jaettua Node-corea, jotta deploy on yksinkertainen.
//
// Suojaus: deployataan verify_jwt = false (config.toml) ja portti suojataan
// jaetulla salaisuudella (x-cron-secret -header). Cron lähettää sen; julkinen
// kutsu ilman oikeaa salaisuutta saa 401.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const FEED_URL =
  "https://afir.digitraffic.fi/api/charging-network/v1/locations/statuses/all";

type StatusClass =
  | "available"
  | "charging"
  | "reserved"
  | "blocked"
  | "out_of_order"
  | "unknown"
  | "excluded"
  | "other_status";

const STATUS_MAP: Record<string, StatusClass> = {
  AVAILABLE: "available",
  CHARGING: "charging",
  RESERVED: "reserved",
  BLOCKED: "blocked",
  INOPERATIVE: "out_of_order",
  OUTOFORDER: "out_of_order",
  UNKNOWN: "unknown",
  PLANNED: "excluded",
  REMOVED: "excluded",
};

function classify(raw: string | null | undefined): StatusClass {
  if (raw == null || raw === "") return "unknown";
  return STATUS_MAP[raw.trim().toUpperCase()] ?? "other_status";
}

interface Counts {
  fast_total: number;
  fast_available: number;
  fast_charging: number;
  fast_reserved: number;
  fast_blocked: number;
  fast_out_of_order: number;
  fast_unknown: number;
  fast_other: number;
}

function emptyCounts(): Counts {
  return {
    fast_total: 0,
    fast_available: 0,
    fast_charging: 0,
    fast_reserved: 0,
    fast_blocked: 0,
    fast_out_of_order: 0,
    fast_unknown: 0,
    fast_other: 0,
  };
}

/** Lisää status laskuriin. excluded (PLANNED/REMOVED) ei kasvata kapasiteettia. */
function add(c: Counts, cls: StatusClass): void {
  switch (cls) {
    case "excluded":
      return;
    case "available":
      c.fast_available++;
      break;
    case "charging":
      c.fast_charging++;
      break;
    case "reserved":
      c.fast_reserved++;
      break;
    case "blocked":
      c.fast_blocked++;
      break;
    case "out_of_order":
      c.fast_out_of_order++;
      break;
    case "unknown":
      c.fast_unknown++;
      break;
    case "other_status":
      c.fast_other++;
      break;
  }
  c.fast_total++;
}

function pct(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}

function withPct(c: Counts) {
  const notAvailable =
    c.fast_charging + c.fast_reserved + c.fast_blocked + c.fast_out_of_order + c.fast_unknown;
  return {
    ...c,
    occupancy_percent: pct(c.fast_charging, c.fast_total),
    unavailable_percent: pct(notAvailable, c.fast_total),
  };
}

Deno.serve(async (req: Request) => {
  // ── Suojaus: jaettu salaisuus ──────────────────────────────────────────
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function logFailure(message: string) {
    await supabase.from("collector_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      success: false,
      error_message: message,
      duration_ms: Date.now() - t0,
    });
  }

  try {
    // 1. EVSE-metadata kannasta (sivuttaen, ei 23 MB:n locations/all)
    type EvseRow = { id: string; location_id: string; is_fast_charger: boolean | null };
    const evses: EvseRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("evses")
        .select("id, location_id, is_fast_charger")
        .range(from, from + 999);
      if (error) throw new Error(`evses-luku: ${error.message}`);
      if (!data || data.length === 0) break;
      evses.push(...(data as EvseRow[]));
      if (data.length < 1000) break;
    }

    // 2. AFIR-statukset suoraan Digitrafficista
    const res = await fetch(FEED_URL, {
      headers: { "Digitraffic-User": "PrivateAFIRTracker-Edge/1.0" },
    });
    if (!res.ok) throw new Error(`Digitraffic HTTP ${res.status}`);
    const raw = (await res.json()) as {
      modifiedAt?: string;
      statuses?: { evseId?: string; status?: string }[];
    };
    const idx = new Map<string, StatusClass>();
    for (const s of raw.statuses ?? []) {
      if (s.evseId) idx.set(s.evseId, classify(s.status));
    }
    const feedModifiedAt = raw.modifiedAt ?? new Date().toISOString();
    const measuredAt = new Date().toISOString();
    const dataAgeSeconds = Math.max(
      0,
      Math.round((Date.parse(measuredAt) - Date.parse(feedModifiedAt)) / 1000)
    );

    // 3. Aggregointi: valtakunnallinen + asemittain (vain pikalaturit)
    const national = emptyCounts();
    const byStation = new Map<string, Counts>();
    for (const e of evses) {
      let s = byStation.get(e.location_id);
      if (!s) {
        s = emptyCounts();
        byStation.set(e.location_id, s);
      }
      if (e.is_fast_charger !== true) continue;
      const cls = idx.get(e.id) ?? "unknown";
      add(national, cls);
      add(s, cls);
    }

    // 4. national_snapshots
    {
      const { error } = await supabase.from("national_snapshots").insert({
        measured_at: measuredAt,
        ...withPct(national),
        data_source_updated_at: feedModifiedAt,
      });
      if (error) throw new Error(`national_snapshots: ${error.message}`);
    }

    // 5. latest_station_status (upsert erissä)
    const stationRows = [...byStation.entries()].map(([location_id, c]) => ({
      location_id,
      ...withPct(c),
      updated_at: feedModifiedAt,
      data_age_seconds: dataAgeSeconds,
    }));
    for (let i = 0; i < stationRows.length; i += 1000) {
      const { error } = await supabase
        .from("latest_station_status")
        .upsert(stationRows.slice(i, i + 1000), { onConflict: "location_id" });
      if (error) throw new Error(`latest_station_status: ${error.message}`);
    }

    // 6. watchlist_station_snapshots (vain seuratut)
    const { data: wl, error: wlErr } = await supabase.from("watchlist").select("location_id");
    if (wlErr) throw new Error(`watchlist-luku: ${wlErr.message}`);
    const watched = [...new Set((wl ?? []).map((w: { location_id: string }) => w.location_id))];
    const byId = new Map(stationRows.map((s) => [s.location_id, s]));
    const snaps = watched
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => ({
        location_id: s.location_id,
        measured_at: measuredAt,
        fast_total: s.fast_total,
        fast_available: s.fast_available,
        fast_charging: s.fast_charging,
        fast_reserved: s.fast_reserved,
        fast_blocked: s.fast_blocked,
        fast_out_of_order: s.fast_out_of_order,
        fast_unknown: s.fast_unknown,
        fast_other: s.fast_other,
        occupancy_percent: s.occupancy_percent,
        unavailable_percent: s.unavailable_percent,
      }));
    if (snaps.length > 0) {
      const { error } = await supabase.from("watchlist_station_snapshots").insert(snaps);
      if (error) throw new Error(`watchlist_station_snapshots: ${error.message}`);
    }

    // 7. Onnistunut ajo lokiin
    await supabase.from("collector_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      success: true,
      status_count: idx.size,
      location_count: stationRows.length,
      duration_ms: Date.now() - t0,
    });

    return Response.json({
      ok: true,
      fast_charging: national.fast_charging,
      stations: stationRows.length,
      status_count: idx.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logFailure(message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
