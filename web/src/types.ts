// DB-rivien tyypit (vastaavat Supabase-tauluja). Pidetään frontend irrallaan
// collector-coresta; vain luettavat kentät.

export interface NationalSnapshot {
  measured_at: string;
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
  data_source_updated_at: string | null;
}

export interface LatestStationStatus {
  location_id: string;
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
  updated_at: string | null;
  data_age_seconds: number | null;
}

export interface LocationRow {
  id: string;
  name: string | null;
  operator_name: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  max_power_kw: number | null;
  fast_evse_count: number | null;
}
