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
 * Datan tuoreusluokka. Kynnykset mitoitettu 10 min keruuvälille (cron-väli 10 min):
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

/** Pvm + kellonaika "11.7.2026 klo 14.30" (kuvaajan tooltip). */
export function formatDateTimeLabel(t: number): string {
  const d = new Date(t);
  const date = d.toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: TZ,
  });
  const time = d.toLocaleTimeString("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
  return `${date} klo ${time}`;
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

// ── Päivä- ja kuukausikoosteet (Trendit) ────────────────────────────────────
// Kannan näkymät palauttavat date-sarakkeet muodossa "2026-06-01" (ilman
// kellonaikaa ja vyöhykettä). Ne on jo laskettu Suomen aikaa noudattaen, joten
// ne tulkitaan sellaisenaan paikalliseksi päiväksi — new Date("2026-06-01")
// olisi UTC-keskiyö ja voisi näyttää edellisen päivän.

const MONTHS_LONG = [
  "Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kesäkuu",
  "Heinäkuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu",
];

const MONTHS_SHORT = [
  "tammi", "helmi", "maalis", "huhti", "touko", "kesä",
  "heinä", "elo", "syys", "loka", "marras", "joulu",
];

/** "2026-06-01" → paikallinen Date (keskiyö), ei vyöhykesiirtymää. */
export function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Kuukausi x-akselille: "kesä", tammikuussa vuosiluku mukaan ("tammi 27"). */
export function formatMonthShort(s: string): string {
  const d = parseDateOnly(s);
  const name = MONTHS_SHORT[d.getMonth()]!;
  return d.getMonth() === 0 ? `${name} ${String(d.getFullYear()).slice(2)}` : name;
}

/** Kuukausi tooltipiin: "Kesäkuu 2026". */
export function formatMonthLong(s: string): string {
  const d = parseDateOnly(s);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** Päivä listaan: "pe 19.6.2026". */
export function formatDayLong(s: string): string {
  const d = parseDateOnly(s);
  const wd = d.toLocaleDateString("fi-FI", { weekday: "short" });
  return `${wd} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Päivä tiiviisti: "19.6.2026". */
export function formatDayShort(s: string): string {
  const d = parseDateOnly(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** Paikallinen päivä muodossa "YYYY-MM-DD" (päivämääräsyötteet, date-sarakkeet). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
