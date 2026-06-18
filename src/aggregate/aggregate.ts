import type {
  Evse,
  EvseStatus,
  Location,
  NationalAggregate,
  StationAggregate,
} from "../domain/types.js";
import { classifyStatus } from "../parser/status.js";

/**
 * Kevyt EVSE-muoto aggregointiin. Collector lukee tämän kannasta (evses-taulu)
 * ilman koko Location/Connector-puun rakentamista.
 */
export interface AggregatableEvse {
  id: string;
  locationId: string;
  isFastCharger: boolean;
}

interface Counts {
  fastTotal: number;
  fastAvailable: number;
  fastCharging: number;
  fastReserved: number;
  fastBlocked: number;
  fastOutOfOrder: number;
  fastUnknown: number;
  fastOther: number;
}

function emptyCounts(): Counts {
  return {
    fastTotal: 0,
    fastAvailable: 0,
    fastCharging: 0,
    fastReserved: 0,
    fastBlocked: 0,
    fastOutOfOrder: 0,
    fastUnknown: 0,
    fastOther: 0,
  };
}

/**
 * Aggregoi pikalaturi-EVSE:t statusluokkien mukaan.
 * - Vain `isFastCharger`-EVSE:t lasketaan.
 * - Puuttuva status -> `unknown` (statusClass-oletus).
 * - `excluded` (PLANNED/REMOVED) jätetään kokonaan pois (ei kapasiteettia, §8).
 */
function countEvses(
  evses: AggregatableEvse[],
  statuses: Map<string, EvseStatus>,
): Counts {
  const c = emptyCounts();
  for (const evse of evses) {
    if (!evse.isFastCharger) continue;
    const status = statuses.get(evse.id);
    const cls = status ? status.statusClass : classifyStatus(null);

    switch (cls) {
      case "excluded":
        continue; // ei lasketa kapasiteettiin
      case "available":
        c.fastAvailable++;
        break;
      case "charging":
        c.fastCharging++;
        break;
      case "reserved":
        c.fastReserved++;
        break;
      case "blocked":
        c.fastBlocked++;
        break;
      case "out_of_order":
        c.fastOutOfOrder++;
        break;
      case "unknown":
        c.fastUnknown++;
        break;
      case "other_status":
        c.fastOther++;
        break;
    }
    c.fastTotal++;
  }
  return c;
}

function pct(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}

function withPercentages(c: Counts): Counts & {
  occupancyPercent: number | null;
  unavailablePercent: number | null;
} {
  // §8: occupancy = charging / total
  const occupancyPercent = pct(c.fastCharging, c.fastTotal);
  // §8: not_available = charging + reserved + blocked + out_of_order + unknown
  const notAvailable =
    c.fastCharging +
    c.fastReserved +
    c.fastBlocked +
    c.fastOutOfOrder +
    c.fastUnknown;
  const unavailablePercent = pct(notAvailable, c.fastTotal);
  return { ...c, occupancyPercent, unavailablePercent };
}

/** Yhden aseman aggregaatti. */
export function aggregateStation(
  location: Location,
  statuses: Map<string, EvseStatus>,
): StationAggregate {
  const c = withPercentages(countEvses(location.evses, statuses));
  return { locationId: location.id, ...c };
}

/** Valtakunnallinen aggregaatti yli kaikkien asemien. */
export function aggregateNational(
  locations: Location[],
  statuses: Map<string, EvseStatus>,
): NationalAggregate {
  const allEvses = locations.flatMap((l) => l.evses);
  return withPercentages(countEvses(allEvses, statuses));
}

// ── Flat-variantit collectorille (EVSE-metadata luettu kannasta) ──────────

/** Valtakunnallinen aggregaatti kevyestä EVSE-listasta. */
export function aggregateNationalFlat(
  evses: AggregatableEvse[],
  statuses: Map<string, EvseStatus>,
): NationalAggregate {
  return withPercentages(countEvses(evses, statuses));
}

/**
 * Asemakohtaiset aggregaatit kevyestä EVSE-listasta, ryhmiteltynä location_id:llä.
 * Palauttaa rivin jokaiselle asemalle, jolla on vähintään yksi EVSE listassa
 * (myös ne, joilla fast_total = 0).
 */
export function aggregateStationsFlat(
  evses: AggregatableEvse[],
  statuses: Map<string, EvseStatus>,
): Map<string, StationAggregate> {
  const byLocation = new Map<string, AggregatableEvse[]>();
  for (const e of evses) {
    const list = byLocation.get(e.locationId);
    if (list) list.push(e);
    else byLocation.set(e.locationId, [e]);
  }
  const result = new Map<string, StationAggregate>();
  for (const [locationId, list] of byLocation) {
    result.set(locationId, {
      locationId,
      ...withPercentages(countEvses(list, statuses)),
    });
  }
  return result;
}
