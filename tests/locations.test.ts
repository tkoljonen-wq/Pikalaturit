import { describe, it, expect } from "vitest";
import { parseLocations } from "../src/parser/locations.js";
import type { RawLocationsResponse } from "../src/parser/locations.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { loadFixture } from "./fixtures.js";

const raw = loadFixture<RawLocationsResponse>("locations-sample.json");
const locations = parseLocations(raw);
const byId = new Map(locations.map((l) => [l.id, l]));
const allEvses = locations.flatMap((l) => l.evses);
const evseById = new Map(allEvses.map((e) => [e.id, e]));

const HELEN = "FI-HLN-638823878716277047";

// Suunnitelma §16.1 — parseritestit
describe("parseLocations: perustiedot", () => {
  it("löytää location-, EVSE- ja connector-id:t", () => {
    expect(locations.length).toBeGreaterThan(0);
    const helen = byId.get(HELEN);
    expect(helen).toBeDefined();
    expect(helen!.evses.length).toBe(6);
    expect(helen!.evses[0]!.connectors.length).toBe(1);
  });

  it("poimii koordinaatit oikein päin ([lon, lat])", () => {
    const helen = byId.get(HELEN)!;
    // Helsinki: lat ~60, lon ~24-25
    expect(helen.latitude).toBeGreaterThan(59);
    expect(helen.latitude).toBeLessThan(61);
    expect(helen.longitude).toBeGreaterThan(23);
    expect(helen.longitude).toBeLessThan(26);
  });

  it("poimii operaattorin ja osoitteen (skandit ehjinä)", () => {
    const helen = byId.get(HELEN)!;
    expect(helen.operatorPartyId).toBe("HLN");
    expect(helen.operatorCountryCode).toBe("FI");
    expect(helen.city).toBe("Helsinki");
    // address.countryCode on 3-kirjaiminen
    expect(helen.country).toBe("FIN");
  });
});

describe("parseLocations: tehot ja yksiköt", () => {
  it("muuntaa maxElectricPower watista kilowatiksi", () => {
    const e = evseById.get("FI*HLN*E218692*01")!;
    expect(e.connectors[0]!.maxElectricPowerW).toBe(300000);
    expect(e.connectors[0]!.maxPowerKw).toBe(300);
  });

  it("tunnistaa DC- ja AC-liittimet", () => {
    expect(evseById.get("FI*HLN*E218692*01")!.connectors[0]!.isDc).toBe(true);
    expect(evseById.get("FI*911*E*PDC*FI1000244*0000001")!.hasDcConnector).toBe(
      false,
    );
  });
});

describe("parseLocations: pikalaturisuodatus", () => {
  it("DC 300 kW on pikalaturi", () => {
    expect(evseById.get("FI*HLN*E218692*01")!.isFastCharger).toBe(true);
  });

  it("DC 49 kW EI ole pikalaturi (rajatesti)", () => {
    const e = evseById.get("FI*001*E296961")!;
    expect(e.hasDcConnector).toBe(true);
    expect(e.maxPowerKw).toBe(49);
    expect(e.isFastCharger).toBe(false);
  });

  it("AC-laturi ei ole pikalaturi vaikka teho riittäisi", () => {
    expect(evseById.get("FI*911*E*PDC*FI1000244*0000001")!.isFastCharger).toBe(
      false,
    );
  });

  it("matalatehoinen DC (20 kW CHAdeMO+CCS) ei ole pikalaturi", () => {
    const e = evseById.get("FI*001*E26175")!;
    expect(e.hasDcConnector).toBe(true);
    expect(e.isFastCharger).toBe(false);
  });
});

// Synteettiset reunatapaukset, joita fixturessa ei satu olemaan
describe("parseLocations: synteettiset rajatapaukset", () => {
  const make = (powerType: string, watts: number | null): RawLocationsResponse => ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [25, 62] },
        properties: {
          id: "TEST-LOC",
          operator: { partyId: "TST", countryCode: "FI" },
          evses: [
            {
              id: "TEST-EVSE",
              connectors: [{ powerType, maxElectricPower: watts }],
            },
          ],
        },
      },
    ],
  });

  it("DC tasan 50 kW on pikalaturi", () => {
    const [loc] = parseLocations(make("DC", 50000));
    expect(loc!.evses[0]!.isFastCharger).toBe(true);
  });

  it("DC ilman tehotietoa: power_unknown=true, oletuksena ei pikalaturi", () => {
    const [loc] = parseLocations(make("DC", null));
    const e = loc!.evses[0]!;
    expect(e.powerUnknown).toBe(true);
    expect(e.isFastCharger).toBe(false);
  });

  it("includeUnknownPowerDc=true: tuntemattoman tehon DC lasketaan pikalaturiksi", () => {
    const [loc] = parseLocations(make("DC", null), {
      ...DEFAULT_CONFIG,
      includeUnknownPowerDc: true,
    });
    expect(loc!.evses[0]!.isFastCharger).toBe(true);
  });
});
