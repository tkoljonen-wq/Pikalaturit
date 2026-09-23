import { NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Kuvaajat } from "./pages/Kuvaajat";
import { Trendit } from "./pages/Trendit";
import { Seuranta } from "./pages/Seuranta";
import { Asetukset } from "./pages/Asetukset";

const NAV = [
  { to: "/", ico: "⚡", label: "Koti", end: true },
  { to: "/kuvaajat", ico: "📈", label: "Kuvaajat", end: false },
  { to: "/trendit", ico: "📊", label: "Trendit", end: false },
  { to: "/seuranta", ico: "⭐", label: "Seuranta", end: false },
  { to: "/asetukset", ico: "⚙️", label: "Asetukset", end: false },
];

function Layout() {
  const { signOut } = useAuth();
  return (
    <div className="app">
      <header className="app-header">
        <div className="row-between">
          <h1>⚡ Pikalaturit</h1>
          <button className="link" onClick={signOut}>
            Kirjaudu ulos
          </button>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/kuvaajat" element={<Kuvaajat />} />
          <Route path="/trendit" element={<Trendit />} />
          <Route path="/seuranta" element={<Seuranta />} />
          <Route path="/asetukset" element={<Asetukset />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <span className="ico">{n.ico}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-msg">Ladataan…</div>;
  if (!session) return <Login />;
  return <Layout />;
}
