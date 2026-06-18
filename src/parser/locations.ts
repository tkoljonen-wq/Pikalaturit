import type { AppConfig } from "../config.js";
import { DEFAULT_CONFIG, wattsToKw } from "../config.js";
import type { Connector, Evse, Location } from "../domain/types.js";

/**
 * Raaka AFIR GeoJSON -muoto (todennettu, ks. docs/AFIR_datarakenne.md).
 * Vain parseri tuntee nämä polut.
 */
export interface RawLocationsResponse {
  type?: string;
  modifiedAt?: string;
  features?: RawFeature[];
}

interface RawFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: [number, number] } | null;
  properties?: RawLocationProps;
}

interface RawLocationProps {
  id?: string;
  name?: string;
  operator?: {
    id?: string;
    partyId?: string;
    countryCode?: string;
    details?: { name?: string };
  };
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    countryCode?: string;
  };
  modifiedAt?: string;
  evses?: RawEvse[];
}

interface RawEvse {
  id?: string;
  connectors?: RawConnector[];
}

interface RawConnector {
  powerType?: string;
  standard?: string;
  format?: string;
  maxVoltage?: number;
  maxAmperage?: number;
  maxElectricPower?: number | null;
}

function isDcPowerType(powerType: string | null | undefined): boolean {
  return powerType?.toUpperCase() === "DC";
}

function parseConnector(raw: RawConnector): Connector {
  const watts =
    typeof raw.maxElectricPower === "number" ? raw.maxElectricPower : null;
  return {
    standard: raw.standard ?? null,
    format: raw.format ?? null,
    powerType: raw.powerType ?? null,
    maxVoltage: raw.maxVoltage ?? null,
    maxAmperage: raw.maxAmperage ?? null,
    maxElectricPowerW: watts,
    maxPowerKw: watts == null ? null : wattsToKw(watts),
    isDc: isDcPowerType(raw.powerType),
  };
}

/**
 * Pikalaturius (todennettu logiikka, docs/AFIR_datarakenne.md §4):
 * EVSE on pikalaturi jos jollakin liittimellä on DC JA teho >= kynnys.
 * Jos kaikki tehot puuttuvat (power_unknown), tulos riippuu konfiguraatiosta
 * includeUnknownPowerDc (oletus false, suunnitelma §7).
 */
function determineFastCharger(
  connectors: Connector[],
  config: AppConfig,
): { hasDcConnector: boolean; powerUnknown: boolean; isFastCharger: boolean } {
  const hasDcConnector = connectors.some((c) => c.isDc);
  const dcConnectors = connectors.filter((c) => c.isDc);
  const dcWithKnownPower = dcConnectors.filter((c) => c.maxPowerKw != null);

  // power_unknown: EVSE:llä on DC-liitin mutta yhdelläkään DC-liittimellä ei tehotietoa.
  const powerUnknown = hasDcConnector && dcWithKnownPower.length === 0;

  const meetsThreshold = dcWithKnownPower.some(
    (c) => (c.maxPowerKw as number) >= config.fastChargerMinPowerKw,
  );

  let isFastCharger = meetsThreshold;
  if (!isFastCharger && powerUnknown && config.includeUnknownPowerDc) {
    isFastCharger = true;
  }

  return { hasDcConnector, powerUnknown, isFastCharger };
}

function maxKnownPowerKw(connectors: Connector[]): number | null {
  const known = connectors
    .map((c) => c.maxPowerKw)
    .filter((p): p is number => p != null);
  return known.length ? Math.max(...known) : null;
}

function parseEvse(
  raw: RawEvse,
  locationId: string,
  operatorCountryCode: string | null,
  operatorPartyId: string | null,
  config: AppConfig,
): Evse | null {
  if (!raw.id) return null;
  const connectors = (raw.connectors ?? []).map(parseConnector);
  const { hasDcConnector, powerUnknown, isFastCharger } = determineFastCharger(
    connectors,
    config,
  );
  return {
    id: raw.id,
    locationId,
    operatorCountryCode,
    operatorPartyId,
    connectors,
    maxPowerKw: maxKnownPowerKw(connectors),
    hasDcConnector,
    powerUnknown,
    isFastCharger,
  };
}

function parseFeature(feature: RawFeature, config: AppConfig): Location | null {
  const p = feature.properties;
  if (!p?.id) return null;

  const coords = feature.geometry?.coordinates;
  // GeoJSON-järjestys on [lon, lat] — ÄLÄ vaihda.
  const longitude = Array.isArray(coords) ? (coords[0] ?? null) : null;
  const latitude = Array.isArray(coords) ? (coords[1] ?? null) : null;

  const operatorCountryCode = p.operator?.countryCode ?? null;
  const operatorPartyId = p.operator?.partyId ?? null;

  const evses = (p.evses ?? [])
    .map((e) =>
      parseEvse(e, p.id!, operatorCountryCode, operatorPartyId, config),
    )
    .filter((e): e is Evse => e !== null);

  return {
    id: p.id,
    name: p.name ?? null,
    operatorName: p.operator?.details?.name ?? null,
    operatorPartyId,
    operatorCountryCode,
    latitude,
    longitude,
    address: p.address?.street ?? null,
    city: p.address?.city ?? null,
    country: p.address?.countryCode ?? null,
    modifiedAt: p.modifiedAt ?? null,
    evses,
  };
}

/** Parsii AFIR locations/all -GeoJSONin sisäiseen domain-malliin. */
export function parseLocations(
  raw: RawLocationsResponse,
  config: AppConfig = DEFAULT_CONFIG,
): Location[] {
  return (raw.features ?? [])
    .map((f) => parseFeature(f, config))
    .filter((l): l is Location => l !== null);
}
