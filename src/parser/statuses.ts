import type { EvseStatus } from "../domain/types.js";
import { classifyStatus } from "./status.js";

export interface RawStatusesResponse {
  modifiedAt?: string;
  statuses?: RawStatus[];
}

interface RawStatus {
  evseId?: string;
  status?: string;
  modifiedAt?: string;
}

/** Parsii AFIR statuses/all -vastauksen ja luokittelee statukset. */
export function parseStatuses(raw: RawStatusesResponse): EvseStatus[] {
  return (raw.statuses ?? [])
    .filter((s): s is RawStatus & { evseId: string } => Boolean(s.evseId))
    .map((s) => ({
      evseId: s.evseId,
      rawStatus: s.status ?? null,
      statusClass: classifyStatus(s.status),
      modifiedAt: s.modifiedAt ?? null,
    }));
}

/** Hakurakenne: evseId -> status. */
export function statusIndex(statuses: EvseStatus[]): Map<string, EvseStatus> {
  const m = new Map<string, EvseStatus>();
  for (const s of statuses) m.set(s.evseId, s);
  return m;
}
