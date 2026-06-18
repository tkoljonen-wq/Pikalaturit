/**
 * Sisäinen domain-malli (suunnitelma §17 vaihe 2). AFIR-raakadatan kenttäpolut
 * elävät VAIN parserissa; muu sovellus käyttää näitä tyyppejä.
 */

/** Sovelluksen statusluokat (suunnitelma §8). */
export type StatusClass =
  | "available"
  | "charging"
  | "reserved"
  | "blocked"
  | "out_of_order"
  | "unknown"
  | "excluded"
  | "other_status";

export interface Connector {
  standard: string | null;
  format: string | null;
  /** AFIR: "DC" | "AC_3_PHASE" | "AC_1_PHASE". */
  powerType: string | null;
  maxVoltage: number | null;
  maxAmperage: number | null;
  /** Maksimiteho watteina (AFIR maxElectricPower). null = tuntematon. */
  maxElectricPowerW: number | null;
  /** Maksimiteho kilowatteina, johdettu. null = tuntematon. */
  maxPowerKw: number | null;
  isDc: boolean;
}

export interface Evse {
  id: string;
  locationId: string;
  operatorCountryCode: string | null;
  operatorPartyId: string | null;
  connectors: Connector[];
  /** EVSE:n korkein liitinteho kilowatteina (tunnetuista). null = kaikki tuntemattomia. */
  maxPowerKw: number | null;
  hasDcConnector: boolean;
  /** Tehotieto puuttuu kaikilta liittimiltä. */
  powerUnknown: boolean;
  /** Lasketaanko EVSE pikalaturiksi annetulla konfiguraatiolla. */
  isFastCharger: boolean;
}

export interface Location {
  id: string;
  name: string | null;
  operatorName: string | null;
  operatorPartyId: string | null;
  operatorCountryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  /** AFIR address.countryCode on 3-kirjaiminen ("FIN"). */
  country: string | null;
  modifiedAt: string | null;
  evses: Evse[];
}

export interface EvseStatus {
  evseId: string;
  /** Raaka AFIR-status, esim. "CHARGING". null jos puuttuu. */
  rawStatus: string | null;
  statusClass: StatusClass;
  /** AFIR:n per-EVSE modifiedAt — käytä datan iän laskentaan (§15). */
  modifiedAt: string | null;
}

/** Yhden aseman aggregoitu pikalaturitilanne (suunnitelma §8, §9.4). */
export interface StationAggregate {
  locationId: string;
  fastTotal: number;
  fastAvailable: number;
  fastCharging: number;
  fastReserved: number;
  fastBlocked: number;
  fastOutOfOrder: number;
  fastUnknown: number;
  fastOther: number;
  occupancyPercent: number | null;
  unavailablePercent: number | null;
}

/** Valtakunnallinen aggregaatti (suunnitelma §9.5). Sama muoto ilman locationId:tä. */
export type NationalAggregate = Omit<StationAggregate, "locationId">;
