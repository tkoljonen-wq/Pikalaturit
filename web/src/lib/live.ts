// Suora "hae nyt" -haku Digitrafficista (ohittaa GitHub Actions -viiveen).
// Hakee koko maan statusfeedin selaimessa ja aggregoi pikalaturit asemittain /
// valtakunnallisesti. EI kirjoita Supabaseen — näyttö vain. Logiikka peilaa
// coren classifyStatus + aggregate (src/parser/status.ts, src/aggregate).

import { supabase } from "../supabase";

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

function classifyStatus(raw: string | null | undefined): StatusClass {
  if (raw == null || raw === "") return "unknown";
  return STATUS_MAP[raw.trim().toUpperCase()] ?? "other_status";
}

/** Live-tilan muoto — sama kuin latest_station_status UI:ssa. */
export interface LiveStatus {
  fast_total: number;
  fast_available: number;
  fast_charging: number;
  fast_reserved: number;
  fast_blocked: number;
  fast_out_of_order: number;
  fast_unknown: number;
  fast_other: number;
  occupancy_percent: number | null;
  unavailable_percent: number | null;
  data_age_seconds: number | null;
}

export interface StatusFeed {
  modifiedAt: string | null;
  ageSeconds: number | null;
  index: Map<string, StatusClass>;
}

/** Hakee Digitrafficin statusfeedin suoraan selaimesta (~2,3 MB). */
export async function fetchStatusFeed(): Promise<StatusFeed> {
  const res = await fetch(FEED_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Digitraffic HTTP ${res.status}`);
  const raw = (await res.json()) as {
    modifiedAt?: string;
    statuses?: { evseId?: string; status?: string }[];
  };
  const index = new Map<string, StatusClass>();
  for (const s of raw.statuses ?? []) {
    if (s.evseId) index.set(s.evseId, classifyStatus(s.status));
  }
  const modifiedAt = raw.modifiedAt ?? null;
  const ageSeconds = modifiedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(modifiedAt)) / 1000))
    : null;
  return { modifiedAt, ageSeconds, index };
}

function emptyCounts() {
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

function pct(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}

/** Laskee pikalaturi-EVSE-id:t statusluokkien mukaan (excluded jätetään pois). */
function countIds(
  ids: Iterable<string>,
  index: Map<string, StatusClass>,
  ageSeconds: number | null
): LiveStatus {
  const c = emptyCounts();
  for (const id of ids) {
    const cls = index.get(id) ?? "unknown";
    switch (cls) {
      case "excluded":
        continue;
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
  const notAvailable =
    c.fast_charging + c.fast_reserved + c.fast_blocked + c.fast_out_of_order + c.fast_unknown;
  return {
    ...c,
    occupancy_percent: pct(c.fast_charging, c.fast_total),
    unavailable_percent: pct(notAvailable, c.fast_total),
    data_age_seconds: ageSeconds,
  };
}

type EvseRow = { id: string; location_id: string; is_fast_charger: boolean | null };

/** Hakee seurattujen asemien pikalaturi-EVSE:t ja aggregoi live-tilan asemittain. */
export async function liveWatchedStations(
  locationIds: string[],
  feed: StatusFeed
): Promise<Map<string, LiveStatus>> {
  const result = new Map<string, LiveStatus>();
  if (locationIds.length === 0) return result;
  const { data, error } = await supabase
    .from("evses")
    .select("id, location_id, is_fast_charger")
    .in("location_id", locationIds);
  if (error) throw error;
  const byLoc = new Map<string, string[]>();
  for (const e of (data ?? []) as EvseRow[]) {
    if (e.is_fast_charger !== true) continue;
    const list = byLoc.get(e.location_id);
    if (list) list.push(e.id);
    else byLoc.set(e.location_id, [e.id]);
  }
  for (const [loc, ids] of byLoc) {
    result.set(loc, countIds(ids, feed.index, feed.ageSeconds));
  }
  return result;
}

const CACHE_KEY = "pikalaturit:fastEvseIds:v1";
const CACHE_TTL = 12 * 3600 * 1000;

/** Hakee kaikkien pikalaturien EVSE-id:t (välimuistitettu localStorageen 12 h). */
async function fetchFastEvseIds(): Promise<string[]> {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (c && Array.isArray(c.ids) && Date.now() - c.t < CACHE_TTL) return c.ids;
  } catch {
    /* ohitetaan rikkinäinen välimuisti */
  }
  const ids: string[] = [];
  for (let from = 0; from <= 40000; from += 1000) {
    const { data, error } = await supabase
      .from("evses")
      .select("id")
      .eq("is_fast_charger", true)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    ids.push(...data.map((d: { id: string }) => d.id));
    if (data.length < 1000) break;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), ids }));
  } catch {
    /* localStorage täynnä / estetty — ei kriittistä */
  }
  return ids;
}

/** Aggregoi valtakunnallisen live-tilan (kaikki pikalaturit). */
export async function liveNational(feed: StatusFeed): Promise<LiveStatus> {
  const ids = await fetchFastEvseIds();
  return countIds(ids, feed.index, feed.ageSeconds);
}
