// Trendit: pitkän aikavälin kehitys valtakunnallisesta datasta.
//
//   * Kuukausitrendi    — kuukauden päivähuippujen keskiarvo pylväinä.
//   * Laturikanta       — pikalatureiden kokonaismäärä, lukema joka päivältä.
//   * Autoja/laturi     — täyssähköautot (Traficom) per pikalatauspiste.
//   * Uudet pikalaturit — seurannan aikana ilmestyneet uudet asemat ja
//                         olemassa olevien asemien laajennukset, yksi rivi per
//                         asema ja päivä.
//   * Ennätyspäivät     — top 20 vuorokautta korkeimman hetkellisen
//                         lataajamäärän mukaan, valittavalta aikaväliltä.
//
// Data tulee kannan koostenäkymistä (national_monthly_stats /
// national_daily_stats / new_fast_chargers, ks. 20260923090000_trend_views.sql
// ja 20260923140000_expansions.sql), joten selain lataa kymmeniä rivejä eikä
// kymmeniätuhansia mittauksia — sama sivu toimii sellaisenaan myös vuosien
// datalla.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { BarChart, type Bar } from "../components/BarChart";
import { LineChart, type ChartPoint } from "../components/LineChart";
import {
  formatDateFull,
  formatDateLabel,
  formatDayLong,
  formatDayShort,
  formatMonthLong,
  formatMonthShort,
  formatMonthYearLabel,
  formatNumber,
  formatPercent,
  formatTime,
  isoDate,
  parseDateOnly,
} from "../lib/format";

type MonthRow = {
  month: string; // "2026-06-01"
  days: number;
  days_in_month: number;
  avg_daily_peak: number;
  peak_charging: number;
  peak_day: string;
  avg_charging: number;
};

type DayRow = {
  day: string;
  samples: number;
  peak_charging: number;
  peak_at: string;
  peak_occupancy_percent: number | null;
  avg_charging: number;
};

type FleetRow = {
  day: string;
  max_fast_total: number;
};

// Trendiluvut muuttuvat korkeintaan keruuvälin tahtiin (10 min), joten muiden
// sivujen 30 s päivitysväli olisi tässä turhaa kuormaa: koostenäkymä lukee
// koko historian läpi joka kyselyllä.
const REFRESH_MS = 5 * 60_000;

/** Prosenttimuutos vertailukohtaan, nuolella. */
function formatDelta(cur: number, prev: number | undefined): string {
  if (prev == null || prev === 0) return "–";
  const pct = ((cur - prev) / prev) * 100;
  const arrow = pct > 0.05 ? "▲" : pct < -0.05 ? "▼" : "";
  return `${arrow}${Math.abs(pct).toFixed(1).replace(".", ",")} %`;
}

/** "2026-06-01" + n kuukautta → "2027-06-01". */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export function Trendit() {
  return (
    <>
      <MonthlyTrend />
      <FleetSize />
      <EvRatio />
      <NewChargers />
      <TopDays />
      <div className="source">
        Lähteet: Fintraffic / Digitraffic, CC BY 4.0; ajoneuvokanta Traficom, CC BY
        4.0. Dataa on aggregoitu ja käsitelty sovelluksessa.
      </div>
    </>
  );
}

// ── Kuukausitrendi ──────────────────────────────────────────────────────────

function MonthlyTrend() {
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const { data, error: err } = await supabase
        .from("national_monthly_stats")
        .select(
          "month, days, days_in_month, avg_daily_peak, peak_charging, peak_day, avg_charging"
        )
        .order("month", { ascending: true });
      if (err) throw err;
      setRows((data ?? []) as MonthRow[]);
      setError(false);
      setLoading(false);
    } catch {
      if (!silent) {
        setError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const thisMonth = isoDate(new Date()).slice(0, 7);

  const bars: Bar[] = useMemo(
    () =>
      rows.map((r) => {
        const running = r.month.slice(0, 7) === thisMonth;
        return {
          key: r.month,
          label: formatMonthShort(r.month),
          value: Number(r.avg_daily_peak),
          faded: running,
          tip: [
            formatMonthLong(r.month) + (running ? " (kesken)" : ""),
            `Päivähuippujen ka ${formatNumber(Math.round(Number(r.avg_daily_peak)))}`,
            `${r.days}/${r.days_in_month} vrk mukana`,
            `Kuukauden huippu ${formatNumber(r.peak_charging)} (${formatDayShort(r.peak_day)})`,
          ],
        };
      }),
    [rows, thisMonth]
  );

  // Vertailut: edellinen kuukausi ja sama kuukausi vuotta aiemmin.
  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const byMonth = new Map(
      rows.map((r) => [r.month.slice(0, 7), Number(r.avg_daily_peak)])
    );
    const last = rows[rows.length - 1]!;
    const prev =
      rows.length > 1 ? Number(rows[rows.length - 2]!.avg_daily_peak) : undefined;
    const [y, m] = last.month.slice(0, 7).split("-").map(Number);
    return {
      last,
      value: Number(last.avg_daily_peak),
      prev,
      yearAgo: byMonth.get(`${y! - 1}-${String(m).padStart(2, "0")}`),
      running: last.month.slice(0, 7) === thisMonth,
    };
  }, [rows, thisMonth]);

  return (
    <>
      <div className="section-title">Kuukausitrendi</div>

      <div className="card">
        {loading ? (
          <div className="center-msg">Ladataan…</div>
        ) : error ? (
          <div className="center-msg">Datan haku epäonnistui.</div>
        ) : rows.length === 0 ? (
          <div className="center-msg">Ei vielä dataa.</div>
        ) : (
          <>
            <BarChart
              bars={bars}
              color="var(--green)"
              integerAxis
              formatAxis={(v) => Math.round(v).toLocaleString("fi-FI")}
              ariaLabel="Pikalaturien päivähuippujen keskiarvo kuukausittain"
            />
            <div className="muted" style={{ marginTop: 10 }}>
              Pylväs = kuukauden päivähuippujen keskiarvo: montako pikalaturia oli
              latauksessa keskimäärin vuorokauden vilkkaimpaan hetkeen. Kesken oleva
              kuukausi on katkoviivalla.
            </div>
          </>
        )}
      </div>

      {summary && !loading && !error && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="num" style={{ color: "var(--green)" }}>
                {formatNumber(Math.round(summary.value))}
              </div>
              <div className="cap">
                {formatMonthLong(summary.last.month)}
                {summary.running ? " (kesken)" : ""}
              </div>
            </div>
            <div className="stat">
              <div className="num">{formatDelta(summary.value, summary.prev)}</div>
              <div className="cap">Muutos ed. kuukaudesta</div>
            </div>
            <div className="stat">
              <div className="num">{formatDelta(summary.value, summary.yearAgo)}</div>
              <div className="cap">Muutos vuodentakaiseen</div>
            </div>
            <div className="stat">
              <div className="num">{rows.length}</div>
              <div className="cap">Kuukautta dataa</div>
            </div>
          </div>

          {rows.length < 13 && (
            <div className="muted" style={{ margin: "10px 2px 0" }}>
              Vuosivertailu näkyy, kun dataa on kertynyt 13 kuukautta — eli{" "}
              {formatMonthLong(addMonths(rows[0]!.month, 12))} alkaen.
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Laturikanta ─────────────────────────────────────────────────────────────
// Pikalatureiden kokonaismäärä, yksi lukema jokaiselta vuorokaudelta.
//
// Lukemana on vuorokauden KORKEIN mittaus: jos Digitrafficin feedistä puuttuu
// hetkellisesti osa asemista, vuorokauden pienin (tai viimeisin) lukema
// notkahtaisi vaikka latureita ei ole poistettu. Aito poisto näkyy seuraavan
// vuorokauden lukemassa.

const DAY_PAGE = 1000; // PostgREST palauttaa kerralla enintään ~1000 riviä

/** Kaikki päivärivit sivuttaen — riittää vuosikymmeniksi (1 rivi/vrk). */
async function fetchAllDays<T>(columns: string): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from <= 20000; from += DAY_PAGE) {
    const { data, error } = await supabase
      .from("national_daily_stats")
      .select(columns)
      .order("day", { ascending: true })
      .range(from, from + DAY_PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < DAY_PAGE) break;
  }
  return all;
}

/** Lukumäärän muutos etumerkillä: "+250", "−12", "–" jos ei vertailukohtaa. */
function formatCountDelta(v: number | null): string {
  if (v == null) return "–";
  const r = Math.round(v);
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${formatNumber(Math.abs(r))}`;
}

function FleetSize() {
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const data = await fetchAllDays<FleetRow>("day, max_fast_total");
      setRows(data);
      setError(false);
      setLoading(false);
    } catch {
      if (!silent) {
        setError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const points: ChartPoint[] = useMemo(
    () =>
      rows.map((r) => ({
        t: parseDateOnly(r.day).getTime(),
        v: Number(r.max_fast_total),
      })),
    [rows]
  );

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const now = Number(last.max_fast_total);
    const lastT = parseDateOnly(last.day).getTime();
    const spanDays = (lastT - parseDateOnly(first.day).getTime()) / 86_400_000;
    // Vertailuluku n vuorokautta sitten: viimeisin rivi, joka on vähintään
    // niin vanha (päiviä voi puuttua, jos keruu on ollut katki).
    const target = lastT - 30 * 86_400_000;
    let ref: FleetRow | null = null;
    for (const r of rows) {
      if (parseDateOnly(r.day).getTime() > target) break;
      ref = r;
    }
    const growth = now - Number(first.max_fast_total);
    return {
      now,
      d30: ref ? now - Number(ref.max_fast_total) : null,
      growth,
      perMonth: spanDays >= 30 ? (growth / spanDays) * 30.44 : null,
      spanDays,
      firstDay: first.day,
    };
  }, [rows]);

  // Monen vuoden jaksolla päivämääräakseli ruuhkautuu → kuukausi/vuosi.
  const timeLabel = stats && stats.spanDays > 400 ? formatMonthYearLabel : formatDateLabel;

  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>
        Pikalatureita Suomessa
      </div>

      <div className="card">
        {loading ? (
          <div className="center-msg">Ladataan…</div>
        ) : error ? (
          <div className="center-msg">Datan haku epäonnistui.</div>
        ) : points.length === 0 ? (
          <div className="center-msg">Ei vielä dataa.</div>
        ) : (
          <>
            <LineChart
              points={points}
              color="var(--accent)"
              formatAxis={(v) => Math.round(v).toLocaleString("fi-FI")}
              formatTimeLabel={timeLabel}
              formatValue={(v) => formatNumber(Math.round(v))}
              formatTooltipTime={formatDateFull}
              integerAxis
              step
            />
            <div className="muted" style={{ marginTop: 10 }}>
              Vähintään 50 kW:n latauspisteiden määrä, yksi lukema vuorokaudessa
              (vuorokauden korkein mittaus). Huomaa, että y-akseli ei ala nollasta.
            </div>
          </>
        )}
      </div>

      {stats && !loading && !error && (
        <div className="stat-grid">
          <div className="stat">
            <div className="num" style={{ color: "var(--accent)" }}>
              {formatNumber(stats.now)}
            </div>
            <div className="cap">Pikalatureita nyt</div>
          </div>
          <div className="stat">
            <div className="num">{formatCountDelta(stats.d30)}</div>
            <div className="cap">Muutos 30 vrk</div>
          </div>
          <div className="stat">
            <div className="num">{formatCountDelta(stats.perMonth)}</div>
            <div className="cap">Kasvu / kk keskimäärin</div>
          </div>
          <div className="stat">
            <div className="num">{formatCountDelta(stats.growth)}</div>
            <div className="cap">Seurannan alusta {formatDayShort(stats.firstDay)}</div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sähköautoja per pikalatauspiste ─────────────────────────────────────────
// Täyssähköisten henkilö- ja pakettiautojen määrä (Traficom, taulu
// vehicle_stock, ks. 20260923160000_vehicle_stock.sql) jaettuna saman päivän
// pikalatauspisteiden määrällä (sama lukema kuin Laturikanta-kuvaajassa).
//
// Autojen määrä tunnetaan vain neljänneksen viimeiseltä päivältä. Päiväkohtainen
// luku saadaan:
//   * julkaistujen neljännesten välillä lineaarisella interpoloinnilla,
//   * viimeisimmän julkaistun neljänneksen jälkeen jatkamalla sen neljänneksen
//     kasvuvauhtia → arvio, piirretään katkoviivalla. Arvio korvautuu
//     todellisella luvulla, kun Traficom julkaisee seuraavan neljänneksen.
// Luvun jättäminen viimeiseen julkaistuun arvoon ei kelpaa: suhdeluku laskisi
// keinotekoisesti joka kerta, kun latureita tulee lisää.

type StockRow = { quarter: string; quarter_end: string; vehicles: number };

type RatioRangeKey = "y1" | "all" | "custom";

const RATIO_RANGES: { key: RatioRangeKey; label: string }[] = [
  { key: "y1", label: "12 kk" },
  { key: "all", label: "Kaikki" },
  { key: "custom", label: "Oma" },
];

type RatioPoint = {
  t: number;
  day: string;
  ratio: number;
  vehicles: number;
  chargers: number;
  estimate: boolean;
};

/** Täyssähköautojen määrä päivälle t neljännespisteistä (ks. yllä). */
function vehiclesAt(t: number, q: { t: number; n: number }[]): number | null {
  if (q.length === 0 || t < q[0]!.t) return null;
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1]!;
    const b = q[i]!;
    if (t <= b.t) return a.n + ((b.n - a.n) * (t - a.t)) / (b.t - a.t);
  }
  const last = q[q.length - 1]!;
  if (q.length < 2) return last.n;
  const prev = q[q.length - 2]!;
  return last.n + ((last.n - prev.n) * (t - last.t)) / (last.t - prev.t);
}

function formatRatio(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

function formatQuarter(q: string): string {
  return q.replace(/^(\d{4})Q(\d)$/, "$2/$1"); // "2026Q2" → "2/2026"
}

function EvRatio() {
  const [range, setRange] = useState<RatioRangeKey>("y1");
  const [from, setFrom] = useState(() => daysAgo(365));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [stock, setStock] = useState<StockRow[]>([]);
  const [days, setDays] = useState<FleetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const today = isoDate(new Date());
  const rangeValid = range !== "custom" || from <= to;

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const [stockRes, dayRows] = await Promise.all([
        supabase
          .from("vehicle_stock")
          .select("quarter, quarter_end, vehicles")
          .eq("fuel", "04")
          .in("vehicle_class", ["01", "02"])
          .order("quarter_end", { ascending: true }),
        fetchAllDays<FleetRow>("day, max_fast_total"),
      ]);
      if (stockRes.error) throw stockRes.error;
      setStock((stockRes.data ?? []) as StockRow[]);
      setDays(dayRows);
      setError(false);
      setLoading(false);
    } catch {
      if (!silent) {
        setError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Henkilö- ja pakettiautot yhteen, yksi piste per neljännes.
  const quarters = useMemo(() => {
    const m = new Map<string, { quarter: string; t: number; n: number }>();
    for (const r of stock) {
      const cur = m.get(r.quarter_end) ?? {
        quarter: r.quarter,
        t: parseDateOnly(r.quarter_end).getTime(),
        n: 0,
      };
      cur.n += Number(r.vehicles);
      m.set(r.quarter_end, cur);
    }
    return [...m.values()].sort((a, b) => a.t - b.t);
  }, [stock]);

  const lastQuarter = quarters[quarters.length - 1] ?? null;

  const series: RatioPoint[] = useMemo(() => {
    const out: RatioPoint[] = [];
    for (const d of days) {
      const t = parseDateOnly(d.day).getTime();
      const chargers = Number(d.max_fast_total);
      const vehicles = vehiclesAt(t, quarters);
      if (vehicles == null || chargers <= 0) continue;
      out.push({
        t,
        day: d.day,
        ratio: vehicles / chargers,
        vehicles,
        chargers,
        estimate: lastQuarter != null && t > lastQuarter.t,
      });
    }
    return out;
  }, [days, quarters, lastQuarter]);

  const visible = useMemo(() => {
    if (range === "all") return series;
    const [f, t] = range === "y1" ? [daysAgo(365), today] : [from, to];
    return series.filter((p) => p.day >= f && p.day <= t);
  }, [series, range, from, to, today]);

  const points: ChartPoint[] = useMemo(
    () => visible.map((p) => ({ t: p.t, v: p.ratio })),
    [visible]
  );

  const first = visible[0] ?? null;
  const last = visible[visible.length - 1] ?? null;
  const spanDays = first && last ? (last.t - first.t) / 86_400_000 : 0;
  const timeLabel = spanDays > 400 ? formatMonthYearLabel : formatDateLabel;
  const seriesStart = series[0]?.day ?? null;

  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>
        Sähköautoja per pikalatauspiste
      </div>

      <div className="segmented" role="tablist" aria-label="Aikaväli">
        {RATIO_RANGES.map((r) => (
          <button
            key={r.key}
            className={r.key === range ? "active" : ""}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="card date-range">
          <label>
            Alkaen
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Päättyen
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="center-msg">Ladataan…</div>
        ) : error ? (
          <div className="center-msg">Datan haku epäonnistui.</div>
        ) : !rangeValid ? (
          <div className="center-msg">Tarkista aikaväli.</div>
        ) : points.length === 0 ? (
          <div className="center-msg">
            {series.length === 0 ? "Ei vielä dataa." : "Ei dataa valitulta aikaväliltä."}
          </div>
        ) : (
          <>
            <LineChart
              points={points}
              color="var(--green)"
              // Suhdeluku muuttuu hitaasti → tikit usein puolikkaan välein.
              formatAxis={(v) => v.toLocaleString("fi-FI", { maximumFractionDigits: 1 })}
              formatTimeLabel={timeLabel}
              formatValue={(v) => `${formatRatio(v)} autoa`}
              formatTooltipTime={formatDateFull}
              {...(lastQuarter ? { estimateFrom: lastQuarter.t } : {})}
            />
            <div className="muted" style={{ marginTop: 10 }}>
              Liikennekäytössä olevat täyssähköiset henkilö- ja pakettiautot jaettuna
              vähintään 50 kW:n latauspisteiden määrällä (ladattavat hybridit eivät
              ole mukana). Autojen määrä julkaistaan neljännesvuosittain, joten
              neljännesten väliset päivät on interpoloitu.
              {lastQuarter &&
                ` Katkoviiva ${formatDayShort(isoDate(new Date(lastQuarter.t)))} jälkeen on arvio neljänneksen ${formatQuarter(lastQuarter.quarter)} kasvuvauhdilla — se korvautuu todellisella luvulla, kun Traficom julkaisee seuraavan neljänneksen.`}
              {range === "y1" &&
                seriesStart &&
                seriesStart > daysAgo(365) &&
                ` Dataa on ${formatDayShort(seriesStart)} alkaen, joten koko 12 kk jakso täyttyy vähitellen.`}
            </div>
          </>
        )}
      </div>

      {!loading && !error && rangeValid && first && last && (
        <div className="stat-grid">
          <div className="stat">
            <div className="num" style={{ color: "var(--green)" }}>
              {formatRatio(last.ratio)}
            </div>
            <div className="cap">
              Autoa / latauspiste {formatDayShort(last.day)}
              {last.estimate ? " (arvio)" : ""}
            </div>
          </div>
          <div className="stat">
            <div className="num">{formatDelta(last.ratio, first.ratio)}</div>
            <div className="cap">Muutos jaksolla {formatDayShort(first.day)} alkaen</div>
          </div>
          {lastQuarter && (
            <div className="stat">
              <div className="num">{formatNumber(lastQuarter.n)}</div>
              <div className="cap">
                Täyssähköautoja {formatQuarter(lastQuarter.quarter)} (Traficom)
              </div>
            </div>
          )}
          <div className="stat">
            <div className="num">{formatNumber(last.chargers)}</div>
            <div className="cap">Pikalatauspisteitä {formatDayShort(last.day)}</div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Uudet pikalaturit ───────────────────────────────────────────────────────
// Yhdistetty aikajana kahdesta tapahtumasta (näkymä new_fast_chargers, ks.
// 20260923140000_expansions.sql):
//
//   kind = "station"   koko asema on uusi (tai AC-asemasta tuli pikalataus-
//                      asema).
//   kind = "expansion" olemassa olevalle asemalle lisättiin latureita.
//   kind = "operator_change"
//                      olemassa oleva asema uudella operaattorilla/tunnisteella
//                      (esim. Helen → Plugit 9/2026) — ei uusia latureita.
//                      Ks. 20260924100000_operator_change.sql.
//
// Yksi rivi = yhden aseman yhtenä päivänä saama erä, ei rivi per laturi.
// Päivä on se, jona laturit ilmestyivät omaan aineistoon — AFIR-datassa ei
// ole avaus- tai perustamispäivää, eikä sitä saa takautuvasti mistään.

type NewChargerRow = {
  kind: "station" | "expansion" | "operator_change";
  location_id: string;
  name: string | null;
  city: string | null;
  operator_name: string | null;
  fast_total: number | null;
  added_count: number;
  added_max_power_kw: number | null;
  added_day: string;
  previous_operator: string | null;
};

type NewRangeKey = "latest" | "d30" | "y1" | "custom";

const NEW_RANGES: { key: NewRangeKey; label: string }[] = [
  { key: "latest", label: "Uusimmat" },
  { key: "d30", label: "30 vrk" },
  { key: "y1", label: "12 kk" },
  { key: "custom", label: "Oma" },
];

const NEW_LATEST_N = 10;
// Aikavälihaun katto. Uusia asemia on tullut n. 30–40 kuukaudessa, joten 300
// riittää yli puoleksi vuodeksi; rajan täyttyessä määrä näytetään "300+".
const NEW_MAX = 300;

/** Paikallinen päivä "YYYY-MM-DD" n vuorokautta sitten. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function NewChargers() {
  const [range, setRange] = useState<NewRangeKey>("latest");
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [rows, setRows] = useState<NewChargerRow[]>([]);
  const [since, setSince] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const rangeValid = range !== "custom" || from <= to;
  const today = isoDate(new Date());

  // Milloin uusien laturien kirjaus alkoi. HUOM: ei sama kuin aineiston keruun
  // alku (18.6.2026) — ensiesiintymistä alettiin kirjata vasta 23.9.2026, ja
  // sitä ennen ilmestyneet asemat saivat kaikki saman aikaleiman eikä niitä voi
  // erottaa toisistaan. Ks. 20260923150000_tracking_info.sql. Haetaan kerran.
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("tracking_info")
      .select("new_chargers_since")
      .limit(1)
      .then(({ data }) => {
        const v = (data as { new_chargers_since: string | null }[] | null)?.[0]
          ?.new_chargers_since;
        if (!cancelled && v) setSince(v);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (silent: boolean) => {
      if (!rangeValid) {
        setError(true);
        setLoading(false);
        return;
      }
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      try {
        let q = supabase
          .from("new_fast_chargers")
          .select(
            "kind, location_id, name, city, operator_name, fast_total, added_count, added_max_power_kw, added_day, previous_operator"
          )
          // Saman yön erät saavat saman aikaleiman → toissijaisena nimi.
          .order("added_at", { ascending: false })
          .order("name", { ascending: true });
        if (range === "latest") {
          q = q.limit(NEW_LATEST_N);
        } else {
          const [f, t] =
            range === "d30"
              ? [daysAgo(30), today]
              : range === "y1"
                ? [daysAgo(365), today]
                : [from, to];
          q = q.gte("added_day", f).lte("added_day", t).limit(NEW_MAX);
        }
        const { data, error: err } = await q;
        if (err) throw err;
        setRows((data ?? []) as unknown as NewChargerRow[]);
        setError(false);
        setLoading(false);
      } catch {
        if (!silent) {
          setError(true);
          setLoading(false);
        }
      }
    },
    [range, from, to, rangeValid, today]
  );

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const totals = useMemo(() => {
    let stations = 0;
    let expansions = 0;
    let changes = 0;
    let chargers = 0;
    for (const r of rows) {
      // Operaattorin vaihto ei tuo uusia latureita → ei summaan.
      if (r.kind === "operator_change") {
        changes++;
        continue;
      }
      if (r.kind === "station") stations++;
      else expansions++;
      chargers += Number(r.added_count ?? 0);
    }
    return { stations, expansions, changes, chargers };
  }, [rows]);

  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>
        Uudet pikalaturit
      </div>

      <div className="segmented" role="tablist" aria-label="Aikaväli">
        {NEW_RANGES.map((r) => (
          <button
            key={r.key}
            className={r.key === range ? "active" : ""}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="card date-range">
          <label>
            Alkaen
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Päättyen
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="card new-list">
        {loading ? (
          <div className="center-msg">Ladataan…</div>
        ) : error ? (
          <div className="center-msg">
            {rangeValid ? "Datan haku epäonnistui." : "Tarkista aikaväli."}
          </div>
        ) : rows.length === 0 ? (
          <div className="center-msg">
            {range === "latest"
              ? "Ei vielä uusia pikalatureita. Lista täydentyy, kun aineistoon ilmestyy latureita."
              : "Ei uusia pikalatureita valitulta aikaväliltä."}
          </div>
        ) : (
          rows.map((r) => {
            const station = r.kind === "station";
            const change = r.kind === "operator_change";
            return (
              <div className="new-row" key={`${r.location_id}-${r.added_day}`}>
                <div className="new-main">
                  <div className="new-name">{r.name ?? "Nimetön asema"}</div>
                  <div className="muted">
                    {formatDayShort(r.added_day)}
                    {r.city ? ` · ${r.city}` : ""}
                    {r.added_max_power_kw
                      ? ` · ${formatNumber(Math.round(Number(r.added_max_power_kw)))} kW`
                      : ""}
                    {r.operator_name ? ` · ${r.operator_name}` : ""}
                  </div>
                </div>
                <div className="new-meta">
                  <div
                    className="new-count"
                    style={
                      station
                        ? undefined
                        : { color: change ? "var(--text-dim)" : "var(--green)" }
                    }
                  >
                    {station || change ? "" : "+"}
                    {formatNumber(r.added_count)}
                  </div>
                  <div className="muted">
                    {station
                      ? "uusi asema"
                      : change
                        ? // Alarivi katkeaa kapealla näytöllä → edeltäjä tänne.
                          r.previous_operator
                          ? `ennen ${r.previous_operator}`
                          : "operaattori vaihtui"
                        : `nyt ${formatNumber(r.fast_total)}`}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!loading && !error && range !== "latest" && rows.length > 0 && (
        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="num" style={{ color: "var(--accent)" }}>
              {formatNumber(totals.stations)}
            </div>
            <div className="cap">Uutta asemaa</div>
          </div>
          <div className="stat">
            <div className="num" style={{ color: "var(--green)" }}>
              {formatNumber(totals.expansions)}
            </div>
            <div className="cap">Laajennusta</div>
          </div>
          {totals.changes > 0 && (
            <div className="stat" style={{ gridColumn: "1 / -1" }}>
              <div className="num" style={{ color: "var(--text-dim)" }}>
                {formatNumber(totals.changes)}
              </div>
              <div className="cap">Operaattorin vaihtoa (ei uusia latureita)</div>
            </div>
          )}
          <div className="stat" style={{ gridColumn: "1 / -1" }}>
            <div className="num">
              {formatNumber(totals.chargers)}
              {rows.length >= NEW_MAX ? "+" : ""}
            </div>
            <div className="cap">Uutta pikalaturia yhteensä</div>
          </div>
        </div>
      )}

      <div className="muted" style={{ margin: "10px 2px 16px" }}>
        Luku on kerralla ilmestyneiden pikalatureiden määrä: sininen = uusi asema,
        vihreä = olemassa olevalle asemalle lisätyt laturit (alla aseman määrä
        laajennuksen jälkeen), harmaa = olemassa oleva asema, joka siirtyi
        toiselle operaattorille (ei lasketa uusiin latureihin). Päivä kertoo, milloin laturit ilmestyivät
        AFIR-aineistoon — se ei ole virallinen avauspäivä. Aineisto päivittyy
        kerran vuorokaudessa.
        {since &&
          ` Uusien laturien kirjaus alkoi ${formatDateFull(Date.parse(since))} — sitä ennen ilmestyneitä asemia ja laajennuksia ei voi tunnistaa takautuvasti.`}
      </div>
    </>
  );
}

// ── Ennätyspäivät (Top 20) ──────────────────────────────────────────────────

type RangeKey = "all" | "year" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "all", label: "Kaikki aika" },
  { key: "year", label: "Tämä vuosi" },
  { key: "custom", label: "Oma" },
];

const TOP_N = 20;

function TopDays() {
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState(() =>
    isoDate(new Date(new Date().getFullYear(), 0, 1))
  );
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [rows, setRows] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const rangeValid = range !== "custom" || from <= to;
  const today = isoDate(new Date());

  const load = useCallback(
    async (silent: boolean) => {
      if (!rangeValid) {
        setError(true);
        setLoading(false);
        return;
      }
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      try {
        let q = supabase
          .from("national_daily_stats")
          .select(
            "day, samples, peak_charging, peak_at, peak_occupancy_percent, avg_charging"
          )
          // Tasatilanteessa (sama huippulukema) vanhempi päivä listataan ensin.
          .order("peak_charging", { ascending: false })
          .order("day", { ascending: true })
          .limit(TOP_N);
        if (range === "year") {
          const y = new Date().getFullYear();
          q = q.gte("day", `${y}-01-01`).lte("day", `${y}-12-31`);
        } else if (range === "custom") {
          q = q.gte("day", from).lte("day", to);
        }
        const { data, error: err } = await q;
        if (err) throw err;
        setRows((data ?? []) as DayRow[]);
        setError(false);
        setLoading(false);
      } catch {
        if (!silent) {
          setError(true);
          setLoading(false);
        }
      }
    },
    [range, from, to, rangeValid]
  );

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const max = rows.length ? Number(rows[0]!.peak_charging) : 0;

  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>
        Ennätyspäivät
      </div>

      <div className="segmented" role="tablist" aria-label="Aikaväli">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={r.key === range ? "active" : ""}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="card date-range">
          <label>
            Alkaen
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Päättyen
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="card rank-list">
        {loading ? (
          <div className="center-msg">Ladataan…</div>
        ) : error ? (
          <div className="center-msg">
            {rangeValid ? "Datan haku epäonnistui." : "Tarkista aikaväli."}
          </div>
        ) : rows.length === 0 ? (
          <div className="center-msg">Ei dataa valitulta aikaväliltä.</div>
        ) : (
          rows.map((r, i) => (
            <div className="rank-row" key={r.day}>
              <div
                className="rank-bar"
                style={{
                  width: `${max ? (Number(r.peak_charging) / max) * 100 : 0}%`,
                }}
              />
              <div className="rank-no">{i + 1}.</div>
              <div className="rank-main">
                <div className="rank-day">
                  {formatDayLong(r.day)}
                  {r.day === today && <span className="rank-tag">kesken</span>}
                </div>
                <div className="muted">
                  klo {formatTime(r.peak_at)}
                  {r.peak_occupancy_percent != null &&
                    ` · käyttöaste ${formatPercent(Number(r.peak_occupancy_percent))}`}
                  {` · vrk ka ${formatNumber(Math.round(Number(r.avg_charging)))}`}
                </div>
              </div>
              <div className="rank-val">{formatNumber(Number(r.peak_charging))}</div>
            </div>
          ))
        )}
      </div>

      <div className="muted" style={{ margin: "0 2px 16px" }}>
        Luku on vuorokauden korkein hetkellinen lataajamäärä 10 min mittauksista —
        ei päivän latauskertojen määrä. Kello kertoo, milloin huippu mitattiin.
      </div>
    </>
  );
}
