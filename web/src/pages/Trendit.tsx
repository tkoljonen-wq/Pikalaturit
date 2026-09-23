// Trendit: pitkän aikavälin kehitys valtakunnallisesta datasta.
//
//   * Kuukausitrendi — kuukauden päivähuippujen keskiarvo pylväinä.
//   * Ennätyspäivät  — top 20 vuorokautta korkeimman hetkellisen
//                      lataajamäärän mukaan, valittavalta aikaväliltä.
//
// Data tulee kannan koostenäkymistä (national_monthly_stats /
// national_daily_stats, ks. 20260923090000_trend_views.sql), joten selain
// lataa kymmeniä rivejä eikä kymmeniätuhansia mittauksia — sama sivu toimii
// sellaisenaan myös vuosien datalla.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { BarChart, type Bar } from "../components/BarChart";
import {
  formatDayLong,
  formatDayShort,
  formatMonthLong,
  formatMonthShort,
  formatNumber,
  formatPercent,
  formatTime,
  isoDate,
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
      <TopDays />
      <div className="source">
        Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty
        sovelluksessa.
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
