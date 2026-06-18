import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../supabase";
import { formatAge, formatNumber, formatPercent, freshness } from "../lib/format";

type Status = {
  fast_total: number | null;
  fast_available: number | null;
  fast_charging: number | null;
  occupancy_percent: number | null;
  data_age_seconds: number | null;
};

type Station = {
  id: string;
  name: string | null;
  city: string | null;
  lat: number;
  lon: number;
  operator_name: string | null;
  max_power_kw: number | null;
  fast_evse_count: number | null;
  status?: Status;
};

const COLORS = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  gray: "#64748b",
};

/** Markkerin väri saatavuuden ja datan tuoreuden mukaan. */
function markerColor(s?: Status): string {
  if (!s || s.fast_available == null || freshness(s.data_age_seconds ?? null) === "old") {
    return COLORS.gray;
  }
  const total = s.fast_total ?? 0;
  if (s.fast_available === 0) return COLORS.red;
  if (total > 0 && s.fast_available / total < 0.3) return COLORS.yellow;
  return COLORS.green;
}

const PAGE = 1000;

async function fetchAll<T>(
  table: string,
  columns: string,
  tune: (q: any) => any
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from <= 20000; from += PAGE) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    q = tune(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}

function titleCase(s: string): string {
  return s
    .toLocaleLowerCase("fi-FI")
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase("fi-FI"));
}

type CityAgg = {
  key: string;
  label: string;
  count: number;
  bounds: [[number, number], [number, number]];
};

export function Kartta() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Station | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");

  // ── Datan lataus ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locs, stats, wl] = await Promise.all([
          fetchAll<any>(
            "locations",
            "id, name, city, latitude, longitude, operator_name, max_power_kw, fast_evse_count",
            (q) =>
              q
                .eq("is_active", true)
                .gt("fast_evse_count", 0)
                .not("latitude", "is", null)
          ),
          fetchAll<any>(
            "latest_station_status",
            "location_id, fast_total, fast_available, fast_charging, occupancy_percent, data_age_seconds",
            (q) => q
          ),
          supabase.from("watchlist").select("location_id"),
        ]);
        const statusMap = new Map<string, Status>();
        for (const s of stats) statusMap.set(s.location_id, s);
        const merged: Station[] = locs.map((l) => ({
          id: l.id,
          name: l.name,
          city: l.city,
          lat: l.latitude,
          lon: l.longitude,
          operator_name: l.operator_name,
          max_power_kw: l.max_power_kw,
          fast_evse_count: l.fast_evse_count,
          status: statusMap.get(l.id),
        }));
        if (cancelled) return;
        setStations(merged);
        setWatched(new Set((wl.data ?? []).map((w: any) => w.location_id)));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Kartan alustus ───────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
    }).setView([64.5, 26], 5);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // ── Markkereiden piirto ──────────────────────────────────────────────────
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !stations.length) return;
    layer.clearLayers();
    for (const st of stations) {
      const color = markerColor(st.status);
      L.circleMarker([st.lat, st.lon], {
        radius: 5,
        color: "#0b1220",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .on("click", () => setSelected(st))
        .addTo(layer);
    }
  }, [stations]);

  // ── Paikkakunnat (johdettu datasta) ───────────────────────────────────────
  const cities = useMemo<CityAgg[]>(() => {
    const m = new Map<
      string,
      { label: string; count: number; minLa: number; maxLa: number; minLo: number; maxLo: number }
    >();
    for (const st of stations) {
      const raw = (st.city ?? "").trim();
      if (!raw) continue;
      const key = raw.toLocaleLowerCase("fi-FI");
      const e = m.get(key);
      if (e) {
        e.count++;
        e.minLa = Math.min(e.minLa, st.lat);
        e.maxLa = Math.max(e.maxLa, st.lat);
        e.minLo = Math.min(e.minLo, st.lon);
        e.maxLo = Math.max(e.maxLo, st.lon);
      } else {
        m.set(key, {
          label: titleCase(raw),
          count: 1,
          minLa: st.lat,
          maxLa: st.lat,
          minLo: st.lon,
          maxLo: st.lon,
        });
      }
    }
    return [...m.entries()]
      .map(([key, e]) => ({
        key,
        label: e.label,
        count: e.count,
        bounds: [
          [e.minLa, e.minLo],
          [e.maxLa, e.maxLo],
        ] as [[number, number], [number, number]],
      }))
      .sort((a, b) => b.count - a.count);
  }, [stations]);

  const cityMatches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("fi-FI");
    if (q.length < 2) return [];
    return cities.filter((c) => c.key.includes(q)).slice(0, 8);
  }, [query, cities]);

  function flyToCity(c: CityAgg) {
    setQuery("");
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(c.bounds, { padding: [40, 40], maxZoom: 13 });
  }

  async function toggleWatch(st: Station) {
    if (watched.has(st.id)) {
      await supabase.from("watchlist").delete().eq("location_id", st.id);
      setWatched((prev) => {
        const n = new Set(prev);
        n.delete(st.id);
        return n;
      });
    } else {
      const { error: insErr } = await supabase
        .from("watchlist")
        .insert({ location_id: st.id });
      if (!insErr || insErr.message.toLowerCase().includes("duplicate")) {
        setWatched((prev) => new Set(prev).add(st.id));
      }
    }
  }

  const sel = selected;
  const selFresh = sel?.status ? freshness(sel.status.data_age_seconds ?? null) : null;

  return (
    <div className="map-view">
      <div className="map-search">
        <input
          type="text"
          placeholder="Hae paikkakuntaa…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCorrect="off"
          autoCapitalize="off"
        />
        {cityMatches.length > 0 && (
          <div className="map-results">
            {cityMatches.map((c) => (
              <button key={c.key} onClick={() => flyToCity(c)}>
                <span>{c.label}</span>
                <span className="muted">{c.count} asemaa</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={containerRef} className="map-canvas" />

      {loading && <div className="map-badge">Ladataan asemia…</div>}
      {error && <div className="map-badge">Datan haku epäonnistui.</div>}
      {!loading && !error && (
        <div className="map-badge">{formatNumber(stations.length)} pikalaturiasemaa</div>
      )}

      {sel && (
        <div className="sheet">
          <div className="row-between">
            <div className="station-title">
              <div className="st-name">{sel.name ?? "Nimetön asema"}</div>
              <div className="muted">
                {[sel.city, sel.operator_name].filter(Boolean).join(" · ") || "–"}
                {sel.max_power_kw ? ` · ${Math.round(sel.max_power_kw)} kW` : ""}
              </div>
            </div>
            <button
              className="icon-btn"
              aria-label="Sulje"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>

          {sel.status ? (
            <div className="station-status">
              <span className="ss-main">
                <strong style={{ color: "var(--green)" }}>
                  {formatNumber(sel.status.fast_available)}
                </strong>
                {" / "}
                {formatNumber(sel.status.fast_total)} vapaana
              </span>
              <span className="muted">
                {formatNumber(sel.status.fast_charging)} latauksessa ·{" "}
                {formatPercent(sel.status.occupancy_percent)}
              </span>
              {selFresh && (
                <span className="badge">
                  <span className={`dot dot-${selFresh}`} />
                  {formatAge(sel.status.data_age_seconds ?? null)}
                </span>
              )}
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 8 }}>
              Ei tilatietoa.
            </div>
          )}

          <button
            className={watched.has(sel.id) ? "sheet-btn watched" : "sheet-btn"}
            onClick={() => toggleWatch(sel)}
          >
            {watched.has(sel.id) ? "✓ Seurannassa" : "➕ Lisää seurantaan"}
          </button>
        </div>
      )}
    </div>
  );
}
