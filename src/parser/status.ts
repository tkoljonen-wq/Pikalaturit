import type { StatusClass } from "../domain/types.js";

/**
 * Keskitetty statusluokittelu (suunnitelma §8). ÄLÄ käytä raakoja statusarvoja
 * hajautetusti muualla koodissa — kaikki kulkee tämän läpi.
 */
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

export function classifyStatus(raw: string | null | undefined): StatusClass {
  if (raw == null || raw === "") return "unknown";
  const key = raw.trim().toUpperCase();
  return STATUS_MAP[key] ?? "other_status";
}
