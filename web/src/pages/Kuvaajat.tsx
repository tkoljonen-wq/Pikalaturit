import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { LineChart, type ChartPoint } from "../components/LineChart";
import {
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

type RangeKey = "24h" | "7d";
type MetricKey = "charging" | "available" | "occupancy";

const RANGES: { key: RangeKey; label: string; hours: number }[] = [
  { key: "24h", label: "24 h", hours: 24 },
  { key: "7d", label: "7 vrk", hours: 24 * 7 },
];

const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  valueOf: (r: SnapRow) => number | null;
  formatValue: (v: number | null) => string;
  formatAxis: (v: number) => string;
}[] = [
  {
    key: "charging",
    label: "Latauksessa",
    color: "var(--green)",
    valueOf: (r) => r.fast_charging,
    formatValue: (v) => (v == null ? "–" : formatNumber(Math.round(v))),
    formatAxis: (v) => Math.round(v).toLocaleString("fi-FI"),
  },
  {
    key: "available",
    label: "Vapaana",
    color: "var(--accent)",
    valueOf: (r) => r.fast_available,
    formatValue: (v) => (v == null ? "–" : formatNumber(Math.round(v))),
    formatAxis: (v) => Math.round(v).toLocaleString("fi-FI"),
  },
  {
    key: "occupancy",
    label: "Käyttöaste",
    color: "var(--yellow)",
    valueOf: (r) => r.occupancy_percent,
    formatValue: formatPercent,
    formatAxis: (v) => `${v.toFixed(1).replace(".", ",")} %`,
  },
];

const PAGE = 1000;
const MAX_POINTS = 180;

/** Hakee snapshotit sivuttaen (PostgREST palauttaa kerralla enintään ~1000 riviä). */
async function fetchSnapshots(sinceISO: string): Promise<SnapRow[]> {
  const all: SnapRow[] = [];
  for (let from = 0; from <= 20000; from += PAGE) {
    const { data, error } = await supabase
      .from("national_snapshots")
      .select("measured_at, fast_charging, fast_available, occupancy_percent")
      .gte("measured_at", sinceISO)
      .order("measured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as SnapRow[]));
    if (data.length < PAGE) break;
  }
  return all;
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
  return out;
}

export function Kuvaajat() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [metricKey, setMetricKey] = useState<MetricKey>("charging");
  const [rows, setRows] = useState<SnapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const metric = METRICS.find((m) => m.key === metricKey)!;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const hours = RANGES.find((r) => r.key === range)!.hours;
    const sinceISO = new Date(Date.now() - hours * 3600_000).toISOString();
    fetchSnapshots(sinceISO)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const points = useMemo(
    () => downsample(rows, metric.valueOf),
    [rows, metric]
  );

  const stats = useMemo(() => {
    const vals = rows
      .map(metric.valueOf)
      .filter((x): x is number => x != null);
    if (!vals.length) return null;
    return {
      now: vals[vals.length - 1]!,
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  }, [rows, metric]);

  const timeLabel = range === "24h" ? formatHourLabel : formatWeekdayLabel;

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
          <div className="center-msg">Datan haku epäonnistui.</div>
        ) : (
          <LineChart
            points={points}
            color={metric.color}
            formatAxis={metric.formatAxis}
            formatTimeLabel={timeLabel}
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

      <div className="source">
        Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty
        sovelluksessa.
      </div>
    </>
  );
}
