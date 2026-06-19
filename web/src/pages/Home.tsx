import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { NationalSnapshot } from "../types";
import {
  ageSecondsFrom,
  formatAge,
  formatNumber,
  formatPercent,
  formatTime,
  freshness,
} from "../lib/format";
import { fetchStatusFeed, liveNational } from "../lib/live";

const FRESH_LABEL = {
  ok: "Data OK",
  stale: "Data vanhenemassa",
  old: "Data vanhaa",
} as const;

// GitHub-dispatch-tokenin (metadata-cron) vanheneminen. Muistutus näkyy etusivulla
// 14 vrk ennen tätä. Päivitysohje: muistitiedosto pikalaturit-cron.md (uusi PAT →
// .env GITHUB_DISPATCH_TOKEN → npm run setup-metadata-cron).
const TOKEN_EXPIRY = new Date("2027-06-18T21:00:00Z");
const TOKEN_WARN_MS = 14 * 24 * 60 * 60 * 1000;

export function Home() {
  const [snap, setSnap] = useState<NationalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [liveErr, setLiveErr] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("national_snapshots")
      .select("*")
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) setError(true);
    else setSnap(data as NationalSnapshot | null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // päivitä 30 s välein kun auki
    return () => clearInterval(t);
  }, []);

  // "Hae nyt": tuore valtakunnallinen luku suoraan Digitrafficista.
  async function refreshNow() {
    setRefreshing(true);
    setLiveErr(false);
    try {
      const feed = await fetchStatusFeed();
      const live = await liveNational(feed);
      const now = new Date().toISOString();
      setSnap((prev) => ({
        ...(prev ?? ({} as NationalSnapshot)),
        ...live,
        measured_at: now,
        data_source_updated_at: feed.modifiedAt,
      }));
      setLiveAt(now);
    } catch {
      setLiveErr(true);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div className="center-msg">Ladataan…</div>;
  if (error) return <div className="center-msg">Datan haku epäonnistui.</div>;
  if (!snap) return <div className="center-msg">Ei vielä dataa. Collector ei ole ajanut.</div>;

  // Datan ikä: feedin lähdeaika jos saatavilla, muuten mittausaika.
  const age = ageSecondsFrom(snap.data_source_updated_at ?? snap.measured_at);
  const fresh = freshness(age);

  // Tokenin vanhenemismuistutus: näkyy 14 vrk ennen ja vanhenemisen jälkeen.
  const msToExpiry = TOKEN_EXPIRY.getTime() - Date.now();
  const showTokenWarning = msToExpiry <= TOKEN_WARN_MS;
  const tokenExpired = msToExpiry <= 0;
  const daysToExpiry = Math.max(0, Math.ceil(msToExpiry / (24 * 60 * 60 * 1000)));

  return (
    <>
      {showTokenWarning && (
        <div
          className="card"
          style={{ borderColor: "var(--yellow)", fontSize: 13 }}
        >
          <div style={{ fontWeight: 600, color: "var(--yellow)", marginBottom: 6 }}>
            ⚠️ GitHub-token {tokenExpired ? "on vanhentunut" : `vanhenee ${daysToExpiry} pv:n päästä`}
          </div>
          <div className="muted">
            Metadata-cronin GitHub-token vanhenee 18.6.2027. Kun se vanhenee, asemien
            metadata ei enää päivity (status ja muut jatkuvat). Päivitysohje löytyy
            tiedostoista: muistitiedosto <strong>pikalaturit-cron.md</strong> — luo uusi
            fine-grained PAT, päivitä <code>.env</code>:n GITHUB_DISPATCH_TOKEN ja aja{" "}
            <code>npm run setup-metadata-cron</code>.
          </div>
        </div>
      )}

      <div className="card hero">
        <div className="big">{formatNumber(snap.fast_charging)}</div>
        <div className="label">pikalaturilla latauksessa juuri nyt</div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="num" style={{ color: "var(--green)" }}>
            {formatNumber(snap.fast_available)}
          </div>
          <div className="cap">Vapaana</div>
        </div>
        <div className="stat">
          <div className="num">{formatNumber(snap.fast_total)}</div>
          <div className="cap">Pikalatureita yhteensä</div>
        </div>
        <div className="stat">
          <div className="num">{formatPercent(snap.occupancy_percent)}</div>
          <div className="cap">Käyttöaste (latauksessa)</div>
        </div>
        <div className="stat">
          <div className="num">{formatPercent(snap.unavailable_percent)}</div>
          <div className="cap">Ei vapaana</div>
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <span className="badge">
            <span className={`dot dot-${fresh}`} />
            {FRESH_LABEL[fresh]}
          </span>
          <span className="muted">Päivitetty {formatTime(snap.measured_at)}</span>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Datan ikä: {formatAge(age)}
        </div>
        {fresh === "old" && (
          <div className="muted" style={{ marginTop: 6, color: "var(--yellow)" }}>
            Lukemat eivät ole reaaliaikaisia.
          </div>
        )}
        <div className="refresh-row" style={{ marginTop: 12 }}>
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
      </div>

      <div className="card" style={{ fontSize: 13 }}>
        <div className="row-between">
          <span className="muted">Epäkunnossa</span>
          <span>{formatNumber(snap.fast_out_of_order)}</span>
        </div>
        <div className="row-between" style={{ marginTop: 6 }}>
          <span className="muted">Varattu</span>
          <span>{formatNumber(snap.fast_reserved)}</span>
        </div>
        <div className="row-between" style={{ marginTop: 6 }}>
          <span className="muted">Tuntematon</span>
          <span>{formatNumber(snap.fast_unknown)}</span>
        </div>
      </div>

      <div className="source">
        Lähde: Fintraffic / Digitraffic, CC BY 4.0. Dataa on aggregoitu ja käsitelty
        sovelluksessa.
      </div>
    </>
  );
}
