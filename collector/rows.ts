import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "./db.js";

/** Lukee taulun kaikki rivit sivuttaen (Supabasen rivikatto on 1000/haku). */
export async function fetchAllRows<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(
      await client
        .from(table)
        .select(columns)
        .range(from, from + pageSize - 1),
    ) as T[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

/** Kirjoittaa rivit erissä (upsert tai insert). */
export async function writeInBatches<T>(
  rows: T[],
  batchSize: number,
  writer: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await writer(rows.slice(i, i + batchSize));
  }
}
