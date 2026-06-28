// Muotoiluapurit. Aikavyöhyke: Suomi.

const TZ = "Europe/Helsinki";

export function formatTime(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toLocaleString("fi-FI");
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null) return "–";
  return `${n.toFixed(1).replace(".", ",")} %`;
}

/** Datan ikä sekunteina → ihmisluettava (esim. "3 min sitten"). */
export function formatAge(seconds: number | null): string {
  if (seconds == null) return "tuntematon";
  if (seconds < 90) return "juuri nyt";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min sitten`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min sitten` : `${h} h sitten`;
}

export type Freshness = "ok" | "stale" | "old";

/**
 * Datan tuoreusluokka. Kynnykset mitoitettu 10 min keruuvälille (cron */10):
 * OK alle 25 min (≈2 ajoa), vanhenemassa 25–60 min, vanhaa yli 60 min.
 */
export function freshness(ageSeconds: number | null): Freshness {
  if (ageSeconds == null) return "old";
  if (ageSeconds > 60 * 60) return "old";
  if (ageSeconds > 25 * 60) return "stale";
  return "ok";
}

export function ageSecondsFrom(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
}

/** Tunti "00".."23" (kuvaajan 24h-akseli). */
export function formatHourLabel(t: number): string {
  return new Date(t).toLocaleTimeString("fi-FI", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  });
}

/** Viikonpäivä lyhyt "ma".."su" (kuvaajan 7vrk-akseli). */
export function formatWeekdayLabel(t: number): string {
  return new Date(t).toLocaleDateString("fi-FI", {
    weekday: "short",
    timeZone: TZ,
  });
}

/** Päivämäärä lyhyt "1.6." (kuvaajan oma, monen päivän aikaväli). */
export function formatDateLabel(t: number): string {
  return new Date(t).toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "numeric",
    timeZone: TZ,
  });
}
