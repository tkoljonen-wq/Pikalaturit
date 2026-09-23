import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "./db.js";

/**
 * Täyssähköisten henkilö- ja pakettiautojen määrä liikennekäytössä
 * Traficomin tilastorajapinnasta (PxWeb), neljännesvuosittain.
 * Taulu ja lähteen kuvaus: 20260923160000_vehicle_stock.sql.
 *
 * Haetaan joka kerta koko aikasarja (~150 riviä, yksi pyyntö) ja upsertataan:
 * uusi neljännes ilmestyy itsestään, ja myös Traficomin korjaukset vanhoihin
 * lukuihin päivittyvät.
 */
const PX_URL =
  "https://trafi2.stat.fi/PXWeb/api/v1/fi/TraFi/Liikennekaytossa_olevat_ajoneuvot/040_kanta_tau_104.px";

const REGION = "MA1"; // Manner-Suomi
const CLASSES = ["01", "02"]; // henkilöautot, pakettiautot
const FUELS = ["04"]; // sähkö (täyssähkö; hybridit omia koodejaan)

type PxResponse = { data: { key: string[]; values: string[] }[] };

/** "2026Q2" → "2026-06-30" (neljänneksen viimeinen päivä). */
export function quarterEnd(q: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  if (!m) throw new Error(`Tuntematon vuosineljännes: ${q}`);
  return `${m[1]}-${["03-31", "06-30", "09-30", "12-31"][Number(m[2]) - 1]}`;
}

export async function runVehicleStockSync(client: SupabaseClient) {
  const query = {
    query: [
      { code: "Maakunta", selection: { filter: "item", values: [REGION] } },
      { code: "Ajoneuvoluokka", selection: { filter: "item", values: CLASSES } },
      { code: "Käyttövoima", selection: { filter: "item", values: FUELS } },
      { code: "Vuosineljännes", selection: { filter: "all", values: ["*"] } },
    ],
    response: { format: "json" },
  };
  const res = await fetch(PX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Traficom PxWeb: HTTP ${res.status}`);
  const body = (await res.json()) as PxResponse;

  const fetchedAt = new Date().toISOString();
  const rows = body.data
    .map((d) => {
      const [, vehicleClass, fuel, quarter] = d.key;
      // PxWeb merkitsee puuttuvan arvon pisteillä ("..") → ohitetaan.
      const n = Number(d.values[0]);
      if (!vehicleClass || !fuel || !quarter || !Number.isFinite(n)) return null;
      return {
        quarter,
        quarter_end: quarterEnd(quarter),
        vehicle_class: vehicleClass,
        fuel,
        vehicles: n,
        fetched_at: fetchedAt,
      };
    })
    .filter((r) => r !== null);
  if (rows.length === 0) throw new Error("Traficom PxWeb: tyhjä vastaus");

  unwrap(
    await client
      .from("vehicle_stock")
      .upsert(rows, { onConflict: "quarter,vehicle_class,fuel" }),
  );
  const latest = rows.reduce((a, b) => (b.quarter > a ? b.quarter : a), "");
  return { rowCount: rows.length, latestQuarter: latest };
}
