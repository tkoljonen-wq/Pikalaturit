import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { LatestStationStatus } from "../types";
import { formatAge, formatNumber, formatPercent, formatTime, freshness } from "../lib/format";
import { fetchStatusFeed, liveWatchedStations } from "../lib/live";

type LocBrief = {
  id: string;
  name: string | null;
  city: string | null;
  operator_name: string | null;
  max_power_kw: number | null;
  fast_evse_count: number | null;
};

type WatchRow = {
  id: number;
  location_id: string;
  display_name: string | null;
  locations: LocBrief | null;
};

const DOT_LABEL = { ok: "Tuore", stale: "Vanhenemassa", old: "Vanhaa" } as const;

/** Poistaa merkit jotka rikkovat PostgREST .or()-suotimen. */
function sanitize(q: string): string {
  return q.replace(/[,()%*]/g, " ").trim();
}

function StationStatus({ st }: { st: LatestStationStatus | undefined }) {
  if (!st) return <div className="muted">Ei tilatietoa.</div>;
  const fresh = freshness(st.data_age_seconds);
  return (
    <div className="station-status">
      <span className="ss-main">
        <strong style={{ color: "var(--green)" }}>
          {formatNumber(st.fast_available)}
        </strong>
        {" / "}
        {formatNumber(st.fast_total)} vapaana
      </span>
      <span className="muted">
        {formatNumber(st.fast_charging)} latauksessa · {formatPercent(st.occupancy_percent)}
      </span>
      <span className="badge" title={DOT_LABEL[fresh]}>
        <span className={`dot dot-${fresh}`} />
        {formatAge(st.data_age_seconds)}
      </span>
    </div>
  );
}

export function Seuranta() {
  const [items, setItems] = useState<WatchRow[]>([]);
  const [statuses, setStatuses] = useState<Record<string, LatestStationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocBrief[]>([]);
  const [searching, setSearching] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [liveErr, setLiveErr] = useState(false);

  const load = useCallback(async () => {
    const { data: wl, error: wlErr } = await supabase
      .from("watchlist")
      .select(
        "id, location_id, display_name, locations(id, name, city, operator_name, max_power_kw, fast_evse_count)"
      )
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (wlErr) {
      setError(true);
      setLoading(false);
      return;
    }
    const rows = (wl ?? []).map((r) => ({
      ...r,
      // Supabase upottaa to-one-suhteen objektina (tyypitys voi olla taulukko).
      locations: Array.isArray(r.locations) ? r.locations[0] ?? null : r.locations,
    })) as WatchRow[];
    setItems(rows);

    const ids = rows.map((r) => r.location_id);
    if (ids.length) {
      const { data: st } = await supabase
        .from("latest_station_status")
        .select("*")
        .in("location_id", ids);
      const map: Record<string, LatestStationStatus> = {};
      for (const s of (st ?? []) as LatestStationStatus[]) map[s.location_id] = s;
      setStatuses(map);
    } else {
      setStatuses({});
    }
    setError(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Asemahaku (debounce). Vain pikalaturiasemat.
  useEffect(() => {
    const q = sanitize(query);
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, name, city, operator_name, max_power_kw, fast_evse_count")
        .eq("is_active", true)
        .gt("fast_evse_count", 0)
        .or(`name.ilike.%${q}%,city.ilike.%${q}%`)
        .order("fast_evse_count", { ascending: false })
        .limit(20);
      setResults((data ?? []) as LocBrief[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function add(loc: LocBrief) {
    // user_id täyttyy DB:n defaultista (auth.uid()); RLS sallii vain omistajalle.
    const { error: insErr } = await supabase
      .from("watchlist")
      .insert({ location_id: loc.id });
    // unique-rikkomus = jo seurannassa → ei virheilmoitusta.
    if (insErr && !insErr.message.toLowerCase().includes("duplicate")) {
      setError(true);
      return;
    }
    setQuery("");
    setResults([]);
    await load();
  }

  async function remove(id: number) {
    await supabase.from("watchlist").delete().eq("id", id);
    await load();
  }

  // "Hae nyt": tuore tila suoraan Digitrafficista, ohittaa collectorin viiveen.
  async function refreshNow() {
    const ids = items.map((i) => i.location_id);
    if (!ids.length) return;
    setRefreshing(true);
    setLiveErr(false);
    try {
      const feed = await fetchStatusFeed();
      const live = await liveWatchedStations(ids, feed);
      setStatuses((prev) => {
        const next = { ...prev };
        for (const [loc, s] of live) {
          next[loc] = { ...next[loc], location_id: loc, ...s } as LatestStationStatus;
        }
        return next;
      });
      setLiveAt(new Date().toISOString());
    } catch {
      setLiveErr(true);
    } finally {
      setRefreshing(false);
    }
  }

  const watched = new Set(items.map((i) => i.location_id));

  return (
    <>
      <div className="search-box">
        <input
          type="text"
          placeholder="Hae asemaa nimellä tai paikkakunnalla…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      {items.length > 0 && (
        <div className="refresh-row">
          <button className="refresh-btn" onClick={refreshNow} disabled={refreshing}>
            {refreshing ? "Haetaan…" : "🔄 Hae nyt"}
          </button>
          {liveErr ? (
            <span className="muted" style={{ color: "var(--yellow)" }}>
              Suorahaku epäonnistui.
            </span>
          ) : liveAt ? (
            <span className="muted">Suora haku klo {formatTime(liveAt)}</span>
          ) : null}
        </div>
      )}

      {sanitize(query).length >= 2 && (
        <div className="card search-results">
          {searching && <div className="muted">Haetaan…</div>}
          {!searching && results.length === 0 && (
            <div className="muted">Ei osumia.</div>
          )}
          {results.map((r) => {
            const already = watched.has(r.id);
            return (
              <button
                key={r.id}
                className="result-row"
                disabled={already}
                onClick={() => add(r)}
              >
                <span className="rr-text">
                  <span className="rr-name">{r.name ?? "Nimetön asema"}</span>
                  <span className="muted">
                    {[r.city, r.operator_name].filter(Boolean).join(" · ") || "–"}
                    {r.fast_evse_count ? ` · ${r.fast_evse_count} pikalaturia` : ""}
                  </span>
                </span>
                <span className="rr-add">{already ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="center-msg">Ladataan…</div>
      ) : error ? (
        <div className="center-msg">Datan haku epäonnistui.</div>
      ) : items.length === 0 ? (
        <div className="center-msg">
          <p>Ei seurattavia asemia.</p>
          <p className="muted">Hae asema yltä ja lisää se seurantaan.</p>
        </div>
      ) : (
        items.map((it) => {
          const loc = it.locations;
          const title = it.display_name ?? loc?.name ?? it.location_id;
          return (
            <div key={it.id} className="card station-card">
              <div className="row-between">
                <div className="station-title">
                  <div className="st-name">{title}</div>
                  <div className="muted">
                    {[loc?.city, loc?.operator_name].filter(Boolean).join(" · ") || "–"}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Poista seurannasta"
                  onClick={() => remove(it.id)}
                >
                  ✕
                </button>
              </div>
              <StationStatus st={statuses[it.location_id]} />
            </div>
          );
        })
      )}

      <div className="source">
        Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty
        sovelluksessa.
      </div>
    </>
  );
}
