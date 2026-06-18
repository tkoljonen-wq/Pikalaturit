import { describe, it, expect } from "vitest";
import { parseLocations } from "../src/parser/locations.js";
import type { RawLocationsResponse } from "../src/parser/locations.js";
import { parseStatuses, statusIndex } from "../src/parser/statuses.js";
import type { RawStatusesResponse } from "../src/parser/statuses.js";
import {
  aggregateNational,
  aggregateNationalFlat,
  aggregateStation,
  aggregateStationsFlat,
} from "../src/aggregate/aggregate.js";
import type { AggregatableEvse } from "../src/aggregate/aggregate.js";
import { loadFixture } from "./fixtures.js";

// Rakentaa yhden aseman, jossa on lista (powerType, watts) -EVSE:itä,
// ja kullekin EVSE:lle annettu raaka status.
function build(evses: Array<{ pt: string; w: number | null; status: string | null }>) {
  const raw: RawLocationsResponse = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [25, 62] },
        properties: {
          id: "LOC",
          operator: { partyId: "TST", countryCode: "FI" },
          evses: evses.map((e, i) => ({
            id: `E${i}`,
            connectors: [{ powerType: e.pt, maxElectricPower: e.w }],
          })),
        },
      },
    ],
  };
  const statusesRaw: RawStatusesResponse = {
    statuses: evses.map((e, i) =>
      e.status === null ? { evseId: `E${i}` } : { evseId: `E${i}`, status: e.status },
    ),
  };
  const locations = parseLocations(raw);
  const idx = statusIndex(parseStatuses(statusesRaw));
  return { location: locations[0]!, idx };
}

// Suunnitelma §16.3 — aggregaattitestit
describe("aggregateStation: statusluokkien laskenta", () => {
  it("laskee pikalaturit oikeisiin lokeroihin", () => {
    const { location, idx } = build([
      { pt: "DC", w: 100000, status: "CHARGING" },
      { pt: "DC", w: 100000, status: "CHARGING" },
      { pt: "DC", w: 100000, status: "AVAILABLE" },
      { pt: "DC", w: 100000, status: "RESERVED" },
      { pt: "DC", w: 100000, status: "BLOCKED" },
      { pt: "DC", w: 100000, status: "OUTOFORDER" },
      { pt: "DC", w: 100000, status: "INOPERATIVE" },
      { pt: "DC", w: 100000, status: "UNKNOWN" },
    ]);
    const a = aggregateStation(location, idx);
    expect(a.fastTotal).toBe(8);
    expect(a.fastCharging).toBe(2);
    expect(a.fastAvailable).toBe(1);
    expect(a.fastReserved).toBe(1);
    expect(a.fastBlocked).toBe(1);
    expect(a.fastOutOfOrder).toBe(2); // OUTOFORDER + INOPERATIVE
    expect(a.fastUnknown).toBe(1);
  });

  it("AC ja alle 50 kW DC eivät kuulu pikalaturitilastoon", () => {
    const { location, idx } = build([
      { pt: "AC_3_PHASE", w: 22000, status: "CHARGING" },
      { pt: "DC", w: 49000, status: "CHARGING" },
      { pt: "DC", w: 50000, status: "AVAILABLE" },
    ]);
    const a = aggregateStation(location, idx);
    expect(a.fastTotal).toBe(1); // vain DC 50 kW
    expect(a.fastAvailable).toBe(1);
  });

  it("puuttuva status -> unknown", () => {
    const { location, idx } = build([{ pt: "DC", w: 100000, status: null }]);
    const a = aggregateStation(location, idx);
    expect(a.fastUnknown).toBe(1);
    expect(a.fastTotal).toBe(1);
  });

  it("PLANNED/REMOVED (excluded) ei lasketa kapasiteettiin", () => {
    const { location, idx } = build([
      { pt: "DC", w: 100000, status: "AVAILABLE" },
      { pt: "DC", w: 100000, status: "PLANNED" },
      { pt: "DC", w: 100000, status: "REMOVED" },
    ]);
    const a = aggregateStation(location, idx);
    expect(a.fastTotal).toBe(1);
    expect(a.fastAvailable).toBe(1);
  });

  it("käyttöaste = charging/total, käytännön saatavuus = ei-vapaat/total", () => {
    const { location, idx } = build([
      { pt: "DC", w: 100000, status: "CHARGING" },
      { pt: "DC", w: 100000, status: "RESERVED" },
      { pt: "DC", w: 100000, status: "AVAILABLE" },
      { pt: "DC", w: 100000, status: "AVAILABLE" },
    ]);
    const a = aggregateStation(location, idx);
    expect(a.occupancyPercent).toBe(25); // 1/4
    expect(a.unavailablePercent).toBe(50); // (charging+reserved)/4
  });

  it("tyhjä asema -> prosentit null (ei nollalla jakoa)", () => {
    const { location, idx } = build([{ pt: "AC_3_PHASE", w: 22000, status: "CHARGING" }]);
    const a = aggregateStation(location, idx);
    expect(a.fastTotal).toBe(0);
    expect(a.occupancyPercent).toBeNull();
    expect(a.unavailablePercent).toBeNull();
  });
});

describe("flat-variantit (collector-polku)", () => {
  const evses: AggregatableEvse[] = [
    { id: "A1", locationId: "LOC-A", isFastCharger: true },
    { id: "A2", locationId: "LOC-A", isFastCharger: true },
    { id: "B1", locationId: "LOC-B", isFastCharger: true },
    { id: "B2", locationId: "LOC-B", isFastCharger: false }, // ei lasketa
  ];
  const idx = statusIndex(
    parseStatuses({
      statuses: [
        { evseId: "A1", status: "CHARGING" },
        { evseId: "A2", status: "AVAILABLE" },
        { evseId: "B1", status: "AVAILABLE" },
        { evseId: "B2", status: "AVAILABLE" },
      ],
    }),
  );

  it("aggregateNationalFlat laskee yli kaikkien fast-EVSE:iden", () => {
    const nat = aggregateNationalFlat(evses, idx);
    expect(nat.fastTotal).toBe(3);
    expect(nat.fastCharging).toBe(1);
    expect(nat.fastAvailable).toBe(2);
  });

  it("aggregateStationsFlat ryhmittelee location_id:llä", () => {
    const stations = aggregateStationsFlat(evses, idx);
    expect(stations.get("LOC-A")!.fastTotal).toBe(2);
    expect(stations.get("LOC-A")!.fastCharging).toBe(1);
    expect(stations.get("LOC-B")!.fastTotal).toBe(1); // B2 ei ole fast
    expect(stations.get("LOC-B")!.fastAvailable).toBe(1);
  });
});

describe("aggregateNational: fixture-savutesti", () => {
  it("laskee sample-fixturen valtakunnallisen tilanteen", () => {
    const locations = parseLocations(
      loadFixture<RawLocationsResponse>("locations-sample.json"),
    );
    const idx = statusIndex(
      parseStatuses(loadFixture<RawStatusesResponse>("statuses-sample.json")),
    );
    const nat = aggregateNational(locations, idx);
    // Fixturessa ainoat pikalaturit ovat 6 × Helen DC 300 kW, kaikki AVAILABLE
    expect(nat.fastTotal).toBe(6);
    expect(nat.fastAvailable).toBe(6);
    expect(nat.fastCharging).toBe(0);
    expect(nat.occupancyPercent).toBe(0);
  });
});
