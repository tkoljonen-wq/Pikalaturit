import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    if (error) setError("Kirjautuminen epäonnistui. Tarkista tunnukset.");
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card card" onSubmit={onSubmit}>
        <h1 style={{ marginTop: 0 }}>⚡ Pikalaturit</h1>
        <p className="muted">Kirjaudu sisään jatkaaksesi.</p>
        <input
          type="email"
          placeholder="Sähköposti"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Salasana"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Kirjaudutaan…" : "Kirjaudu"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
