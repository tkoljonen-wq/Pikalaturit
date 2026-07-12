import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { LineChart, type ChartPoint } from "../components/LineChart";
import {
  formatDateLabel,
  formatDateTimeLabel,
  formatHourLabel,
  formatNumber,
  formatPercent,
  formatWeekdayLabel,
} from "../lib/format";

type SnapRow = {
  measured_at: string;
  fast_charging: number;
  fast_available: number;
  occupancy_percent: number | null;
};

type RangeKey = "24h" | "7d" | "custom";
type MetricKey = "charging" | "available" | "occupancy";

const RANGES: { key: RangeKey; label: string; hours: number | null }[] = [
  { key: "24h", label: "24 h", hours: 24 },
  { key: "7d", label: "7 vrk", hours: 24 * 7 },
  { key: "custom", label: "Oma", hours: null },
];

const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  integerAxis: boolean;
  valueOf: (r: SnapRow) => number | null;
  formatValue: (v: number | null) => string;
  formatAxis: (v: number) => string;
}[] = [
  {
    key: "charging",
    label: "Latauksessa",
    color: "var(--green)",
    integerAxis: true,
    valueOf: (r) => r.fast_charging,
    formatValue: (v) => (v == null ? "–" : formatNumber(Math.round(v))),
    formatAxis: (v) => Math.round(v).toLocaleString("fi-FI"),
  },
  {
    key: "available",
    label: "Vapaana",
    color: "var(--accent)",
    integerAxis: true,
    valueOf: (r) => r.fast_available,
    formatValue: (v) => (v == null ? "–" : formatNumber(Math.round(v))),
    formatAxis: (v) => Math.round(v).toLocaleString("fi-FI"),
  },
  {
    key: "occupancy",
    label: "Käyttöaste",
    color: "var(--yellow)",
    integerAxis: false,
    valueOf: (r) => r.occupancy_percent,
    formatValue: formatPercent,
    formatAxis: (v) => `${v.toFixed(1).replace(".", ",")} %`,
  },
];

const PAGE = 1000;
const MAX_POINTS = 180;

/** ISO-aikaväli päivämääräsyötteistä: alku 00:00 → loppu seuraavan päivän 00:00 (paikallisaika). */
function dayRangeISO(fromDate: string, toDate: string): { sinceISO: string; untilISO: string } {
  const since = new Date(`${fromDate}T00:00:00`);
  const until = new Date(`${toDate}T00:00:00`);
  until.setDate(until.getDate() + 1); // koko loppupäivä mukaan
  return { sinceISO: since.toISOString(), untilISO: until.toISOString() };
}

/** YYYY-MM-DD tämänhetkisestä paikallisajasta (oletusarvot päivämääräsyötteille). */
function isoDate(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/** Valittu aikaväli ISO-muodossa (custom: koko päivät paikallisajassa). */
function rangeISO(
  range: RangeKey,
  from: string,
  to: string
): { sinceISO: string; untilISO: string | null } {
  if (range === "custom") return dayRangeISO(from, to);
  const hours = RANGES.find((r) => r.key === range)!.hours!;
  return { sinceISO: new Date(Date.now() - hours * 3600_000).toISOString(), untilISO: null };
}

/** Hakee snapshotit sivuttaen (PostgREST palauttaa kerralla enintään ~1000 riviä). */
async function fetchSnapshots<T extends Record<string, unknown>>(
  table: "national_snapshots" | "watchlist_station_snapshots",
  columns: string,
  sinceISO: string,
  untilISO: string | null,
  locationId?: string
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from <= 100000; from += PAGE) {
    let q = supabase
      .from(table)
      .select(columns)
      .gte("measured_at", sinceISO)
      .order("measured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (untilISO) q = q.lt("measured_at", untilISO);
    if (locationId) q = q.eq("location_id", locationId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}

/** Nyt/keskiarvo/min/max valitulle mittarille. */
function computeStats(rows: SnapRow[], valueOf: (r: SnapRow) => number | null) {
  const vals = rows.map(valueOf).filter((x): x is number => x != null);
  if (!vals.length) return null;
  return {
    now: vals[vals.length - 1]!,
    min: Math.min(...vals),
    max: Math.max(...vals),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
  };
}

/** Tiivistää rivit ~MAX_POINTS pisteeseen keskiarvoistamalla (kevyt SVG-piirto). */
function downsample(
  rows: SnapRow[],
  valueOf: (r: SnapRow) => number | null
): ChartPoint[] {
  if (rows.length <= MAX_POINTS) {
    return rows.map((r) => ({ t: Date.parse(r.measured_at), v: valueOf(r) }));
  }
  const size = Math.ceil(rows.length / MAX_POINTS);
  const out: ChartPoint[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const vals = chunk
      .map(valueOf)
      .filter((x): x is number => x != null);
    const mid = chunk[Math.floor(chunk.length / 2)]!;
    out.push({
      t: Date.parse(mid.measured_at),
      v: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    });
  }
  // Oikea reuna: viimeinen piste on tuorein mittaus sellaisenaan, ei lohkon
  // keskiarvo — muuten kuvaajan pää jää väärälle korkeudelle ("Nyt"-arvoon
  // nähden) aina kun tiivistys on käytössä.
  const last = rows[rows.length - 1]!;
  const lastV = valueOf(last);
  if (lastV != null) {
    out[out.length - 1] = { t: Date.parse(last.measured_at), v: lastV };
  }
  return out;
}

export function Kuvaajat() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [metricKey, setMetricKey] = useState<MetricKey>("charging");
  const [rows, setRows] = useState<SnapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Oman aikavälin päivämäärät (oletus: viimeiset 7 vrk).
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 6 * 86400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));

  const metric = METRICS.find((m) => m.key === metricKey)!;
  const customValid = range !== "custom" || from <= to;

  // silent = automaattipäivitys: ei näytä "Ladataan…"-tilaa, vaan vaihtaa
  // datan paikallaan kun se on valmis.
  const loadData = useCallback(
    async (silent: boolean) => {
      if (range === "custom" && from > to) {
        setError(true);
        setLoading(false);
        return;
      }
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      const { sinceISO, untilISO } = rangeISO(range, from, to);
      try {
        const data = await fetchSnapshots<SnapRow>(
          "national_snapshots",
          "measured_at, fast_charging, fast_available, occupancy_percent",
          sinceISO,
          untilISO
        );
        setRows(data);
        setError(false);
        setLoading(false);
      } catch {
        if (!silent) {
          setError(true);
          setLoading(false);
        }
      }
    },
    [range, from, to]
  );

  useEffect(() => {
    loadData(false);
    const t = setInterval(() => loadData(true), 30_000); // päivitä 30 s välein
    return () => clearInterval(t);
  }, [loadData]);

  const points = useMemo(
    () => downsample(rows, metric.valueOf),
    [rows, metric]
  );

  const stats = useMemo(() => computeStats(rows, metric.valueOf), [rows, metric]);

  // Akselin aikaleima: lyhyt aikaväli → tunnit, 7 vrk → viikonpäivät, muuten päivämäärä.
  const spanHours = useMemo(() => {
    if (range === "24h") return 24;
    if (range === "7d") return 24 * 7;
    if (!customValid) return 24;
    return (Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 3600_000 + 24;
  }, [range, from, to, customValid]);

  const timeLabel =
    spanHours <= 36
      ? formatHourLabel
      : spanHours <= 24 * 8
        ? formatWeekdayLabel
        : formatDateLabel;

  return (
    <>
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
              max={isoDate(new Date())}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="segmented" role="tablist" aria-label="Mittari">
        {METRICS.map((m) => (
          <button
            key={m.key}
            className={m.key === metricKey ? "active" : ""}
            onClick={() => setMetricKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="center-msg">Ladataan…</div>
        ) : error ? (
          <div className="center-msg">
            {customValid ? "Datan haku epäonnistui." : "Tarkista aikaväli."}
          </div>
        ) : points.length === 0 ? (
          <div className="center-msg">Ei dataa valitulta aikaväliltä.</div>
        ) : (
          <LineChart
            points={points}
            color={metric.color}
            formatAxis={metric.formatAxis}
            formatTimeLabel={timeLabel}
            formatValue={metric.formatValue}
            formatTooltipTime={formatDateTimeLabel}
            integerAxis={metric.integerAxis}
          />
        )}
      </div>

      {stats && !loading && !error && (
        <div className="stat-grid">
          <div className="stat">
            <div className="num" style={{ color: metric.color }}>
              {metric.formatValue(stats.now)}
            </div>
            <div className="cap">Nyt</div>
          </div>
          <div className="stat">
            <div className="num">{metric.formatValue(stats.avg)}</div>
            <div className="cap">Keskiarvo</div>
          </div>
          <div className="stat">
            <div className="num">{metric.formatValue(stats.min)}</div>
            <div className="cap">Pienin</div>
          </div>
          <div className="stat">
            <div className="num">{metric.formatValue(stats.max)}</div>
            <div className="cap">Suurin</div>
          </div>
        </div>
      )}

      <StationChart
        range={range}
        from={from}
        to={to}
        rangeValid={customValid}
        metric={metric}
        timeLabel={timeLabel}
      />

      <CsvExport />

      <div className="source">
        Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty
        sovelluksessa.
      </div>
    </>
  );
}

// ── Seurattujen asemien käyttöaste ──────────────────────────────────────────
// Data: watchlist_station_snapshots — Edge Function kerää sitä automaattisesti
// kaikista watchlist-asemista 10 min välein (säilytys 180 vrk). Historia alkaa
// kertyä siitä hetkestä kun asema lisätään seurantaan.

type WatchStation = { location_id: string; label: string };

function StationChart({
  range,
  from,
  to,
  rangeValid,
  metric,
  timeLabel,
}: {
  range: RangeKey;
  from: string;
  to: string;
  rangeValid: boolean;
  metric: (typeof METRICS)[number];
  timeLabel: (t: number) => string;
}) {
  const [stations, setStations] = useState<WatchStation[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [rows, setRows] = useState<SnapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Seurattavat asemat valikkoon (sama järjestys kuin Seuranta-sivulla).
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("watchlist")
        .select("location_id, display_name, locations(name, city)")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      const list: WatchStation[] = (data ?? []).map((r) => {
        // Supabase upottaa to-one-suhteen objektina (tyypitys voi olla taulukko).
        const loc = Array.isArray(r.locations) ? r.locations[0] ?? null : r.locations;
        const name = r.display_name ?? loc?.name ?? r.location_id;
        return {
          location_id: r.location_id,
          label: loc?.city ? `${name} · ${loc.city}` : name,
        };
      });
      setStations(list);
      setSelected((prev) =>
        list.some((s) => s.location_id === prev) ? prev : list[0]?.location_id ?? ""
      );
    })();
  }, []);

  const loadData = useCallback(
    async (silent: boolean) => {
      if (!selected || !rangeValid) return;
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      const { sinceISO, untilISO } = rangeISO(range, from, to);
      try {
        const data = await fetchSnapshots<SnapRow>(
          "watchlist_station_snapshots",
          "measured_at, fast_charging, fast_available, occupancy_percent",
          sinceISO,
          untilISO,
          selected
        );
        setRows(data);
        setError(false);
        setLoading(false);
      } catch {
        if (!silent) {
          setError(true);
          setLoading(false);
        }
      }
    },
    [selected, range, from, to, rangeValid]
  );

  useEffect(() => {
    loadData(false);
    const t = setInterval(() => loadData(true), 30_000); // päivitä 30 s välein
    return () => clearInterval(t);
  }, [loadData]);

  const points = useMemo(() => downsample(rows, metric.valueOf), [rows, metric]);
  const stats = useMemo(() => computeStats(rows, metric.valueOf), [rows, metric]);

  if (stations === null) return null; // valikko latautumassa

  return (
    <>
      <div className="section-title" style={{ marginTop: 18 }}>
        Seuratut asemat
      </div>
      {stations.length === 0 ? (
        <div className="card">
          <div className="muted">
            Ei seurattavia asemia. Lisää asemia Seuranta-välilehdellä — historia
            alkaa kertyä heti lisäämisen jälkeen.
          </div>
        </div>
      ) : (
        <>
          <div className="card station-picker">
            <select
              aria-label="Valitse asema"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {stations.map((s) => (
                <option key={s.location_id} value={s.location_id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="card">
            {loading ? (
              <div className="center-msg">Ladataan…</div>
            ) : error ? (
              <div className="center-msg">
                {rangeValid ? "Datan haku epäonnistui." : "Tarkista aikaväli."}
              </div>
            ) : points.length === 0 ? (
              <div className="center-msg">
                Ei dataa valitulta aikaväliltä. Historia kertyy 10 min välein
                siitä alkaen, kun asema on lisätty seurantaan.
              </div>
            ) : (
              <LineChart
                points={points}
                color={metric.color}
                formatAxis={metric.formatAxis}
                formatTimeLabel={timeLabel}
                formatValue={metric.formatValue}
                formatTooltipTime={formatDateTimeLabel}
                integerAxis={metric.integerAxis}
              />
            )}
          </div>

          {stats && !loading && !error && (
            <div className="stat-grid">
              <div className="stat">
                <div className="num" style={{ color: metric.color }}>
                  {metric.formatValue(stats.now)}
                </div>
                <div className="cap">Nyt</div>
              </div>
              <div className="stat">
                <div className="num">{metric.formatValue(stats.avg)}</div>
                <div className="cap">Keskiarvo</div>
              </div>
              <div className="stat">
                <div className="num">{metric.formatValue(stats.min)}</div>
                <div className="cap">Pienin</div>
              </div>
              <div className="stat">
                <div className="num">{metric.formatValue(stats.max)}</div>
                <div className="cap">Suurin</div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── CSV-vienti ──────────────────────────────────────────────────────────────

type ExportField = {
  key: string;
  label: string;
  // numeric: desimaalipilkku Suomen Exceliä varten; date: ISO sellaisenaan.
  kind: "date" | "int" | "num";
};

// measured_at on aina mukana ensimmäisenä sarakkeena.
const EXPORT_FIELDS: ExportField[] = [
  { key: "fast_total", label: "Pikalatureita yhteensä", kind: "int" },
  { key: "fast_available", label: "Vapaana", kind: "int" },
  { key: "fast_charging", label: "Latauksessa", kind: "int" },
  { key: "fast_reserved", label: "Varattu", kind: "int" },
  { key: "fast_blocked", label: "Estetty", kind: "int" },
  { key: "fast_out_of_order", label: "Epäkunnossa", kind: "int" },
  { key: "fast_unknown", label: "Tuntematon", kind: "int" },
  { key: "fast_other", label: "Muu tila", kind: "int" },
  { key: "occupancy_percent", label: "Käyttöaste-%", kind: "num" },
  { key: "unavailable_percent", label: "Ei vapaana -%", kind: "num" },
  { key: "data_source_updated_at", label: "Lähteen aikaleima", kind: "date" },
];

const DEFAULT_FIELDS = new Set([
  "fast_total",
  "fast_available",
  "fast_charging",
  "occupancy_percent",
]);

/** CSV-solu: lainausmerkitys + desimaalipilkku. Erottimena ';' (Suomen Excel). */
function csvCell(value: unknown, kind: ExportField["kind"]): string {
  if (value == null) return "";
  if (kind === "num") return String(value).replace(".", ",");
  const s = String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function CsvExport() {
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 6 * 86400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(DEFAULT_FIELDS));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function exportCsv() {
    if (from > to) {
      setMsg("Tarkista aikaväli.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const fields = EXPORT_FIELDS.filter((f) => selected.has(f.key));
      const cols = ["measured_at", ...fields.map((f) => f.key)].join(", ");
      const { sinceISO, untilISO } = dayRangeISO(from, to);
      const data = await fetchSnapshots<Record<string, unknown>>(
        "national_snapshots",
        cols,
        sinceISO,
        untilISO
      );
      if (data.length === 0) {
        setMsg("Ei dataa valitulta aikaväliltä.");
        return;
      }
      const header = ["Aikaleima", ...fields.map((f) => f.label)].join(";");
      const lines = data.map((r) =>
        [
          csvCell(r.measured_at, "date"),
          ...fields.map((f) => csvCell(r[f.key], f.kind)),
        ].join(";")
      );
      // BOM, jotta Excel tunnistaa UTF-8:n (ä/ö).
      const csv = "﻿" + [header, ...lines].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pikalaturit_${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`Ladattu ${data.length} riviä.`);
    } catch {
      setMsg("Vienti epäonnistui.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="section-title">Vie CSV</div>
      <div className="date-range" style={{ padding: 0, border: "none", margin: 0 }}>
        <label>
          Alkaen
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Päättyen
          <input
            type="date"
            value={to}
            min={from}
            max={isoDate(new Date())}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      <div className="muted" style={{ marginTop: 12, marginBottom: 6 }}>
        Sarakkeet (aikaleima aina mukana)
      </div>
      <div className="field-grid">
        {EXPORT_FIELDS.map((f) => (
          <label key={f.key}>
            <input
              type="checkbox"
              checked={selected.has(f.key)}
              onChange={() => toggle(f.key)}
            />
            {f.label}
          </label>
        ))}
      </div>

      <button
        className="sheet-btn"
        onClick={exportCsv}
        disabled={busy || selected.size === 0}
      >
        {busy ? "Viedään…" : "⬇ Lataa CSV"}
      </button>
      {msg && (
        <div className="muted" style={{ marginTop: 10 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
