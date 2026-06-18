import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../auth";

const APP_VERSION = "0.1.0";
const REPO_URL = "https://github.com/tkoljonen-wq/Pikalaturit";

export function Asetukset() {
  const { session, signOut } = useAuth();
  const [watchCount, setWatchCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadCount() {
    const { count } = await supabase
      .from("watchlist")
      .select("id", { count: "exact", head: true });
    setWatchCount(count ?? 0);
  }

  useEffect(() => {
    loadCount();
  }, []);

  async function clearWatchlist() {
    if (!window.confirm("Tyhjennetäänkö koko seurantalista?")) return;
    const { error } = await supabase.from("watchlist").delete().gte("id", 0);
    if (error) {
      setMsg("Tyhjennys epäonnistui.");
      return;
    }
    setMsg("Seurantalista tyhjennetty.");
    await loadCount();
  }

  return (
    <>
      <div className="card">
        <div className="section-title">Tili</div>
        <div className="row-between">
          <span className="muted">Kirjautunut</span>
          <span>{session?.user.email ?? "–"}</span>
        </div>
        <button className="sheet-btn watched" style={{ marginTop: 14 }} onClick={signOut}>
          Kirjaudu ulos
        </button>
      </div>

      <div className="card">
        <div className="section-title">Seurantalista</div>
        <div className="row-between">
          <span className="muted">Seurattuja asemia</span>
          <span>{watchCount ?? "–"}</span>
        </div>
        <button
          className="sheet-btn danger"
          style={{ marginTop: 14 }}
          disabled={!watchCount}
          onClick={clearWatchlist}
        >
          Tyhjennä seurantalista
        </button>
        {msg && (
          <div className="muted" style={{ marginTop: 10 }}>
            {msg}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Tietoja</div>
        <div className="row-between">
          <span className="muted">Versio</span>
          <span>{APP_VERSION}</span>
        </div>
        <div className="row-between" style={{ marginTop: 8 }}>
          <span className="muted">Lähdekoodi</span>
          <a className="link-a" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <p className="muted" style={{ marginTop: 12, lineHeight: 1.5 }}>
          Tiedot päivittyvät noin 5–15 minuutin välein. Lukemat eivät ole
          reaaliaikaisia. Tuoreusmerkintä kertoo kunkin tiedon iän.
        </p>
        <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Lähde: Fintraffic / Digitraffic, lisenssi CC BY 4.0. Dataa on aggregoitu ja
          käsitelty sovelluksessa.
        </p>
      </div>
    </>
  );
}
