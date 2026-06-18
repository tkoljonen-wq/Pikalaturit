import type { RawLocationsResponse } from "../src/parser/locations.js";
import type { RawStatusesResponse } from "../src/parser/statuses.js";

const BASE = "https://afir.digitraffic.fi/api/charging-network/v1";

// Digitraffic-User: EI henkilötietoja (suunnitelma §4).
const HEADERS: Record<string, string> = {
  "Digitraffic-User": "PrivateAFIRTracker/1.0",
  "Accept-Encoding": "gzip",
  Accept: "application/json",
};

interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
}

/**
 * Hakee AFIR-JSONin. Käsittelee 429:n ja verkkovirheet maltillisella
 * uudelleenyrityksellä (suunnitelma §4, §11.3). Heittää lopulta virheen,
 * jolloin collector kirjaa epäonnistuneen ajon eikä nollaa statuksia.
 */
async function fetchJson<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { retries = 3, timeoutMs = 60_000 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoffMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: HEADERS,
        signal: controller.signal,
      });
      if (res.status === 429) {
        lastError = new Error("AFIR 429 Too Many Requests");
        continue; // hidasta ja yritä uudelleen
      }
      if (!res.ok) {
        throw new Error(`AFIR ${path} -> HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `AFIR-haku epäonnistui (${path}) ${retries + 1} yrityksen jälkeen: ${String(lastError)}`,
  );
}

export const fetchStatuses = () =>
  fetchJson<RawStatusesResponse>("/locations/statuses/all");

export const fetchLocations = () =>
  fetchJson<RawLocationsResponse>("/locations/all", { timeoutMs: 120_000 });
