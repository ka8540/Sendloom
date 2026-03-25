import Link from "next/link";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { getEnvStatus } from "@/lib/env";

export default function SetupPage() {
  const status = getEnvStatus();

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <div style={{ width: "min(820px, 100%)", display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <ThemeSwitcher />
        </div>

        <section className="card" style={{ width: "min(820px, 100%)" }}>
          <h1 style={{ marginTop: 0 }}>Sendloom configuration</h1>
          <p className="muted">Use this page to verify your local environment values and redirect URLs.</p>

          <div className="pre">
            <code>DATABASE_URL=postgresql://ka8540@localhost:5432/sendloom</code>
            <br />
            <code>REDIS_URL=redis://localhost:6379</code>
            <br />
            <br />
            <code>SESSION_SECRET=supersecret123</code>
            <br />
            <br />
            <code>MAIL_PROVIDER=gmail</code>
            <br />
            <code>GOOGLE_CLIENT_ID=your-google-oauth-client-id</code>
            <br />
            <code>GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret</code>
            <br />
            <br />
            <code>APP_BASE_URL=http://localhost:3000</code>
            <br />
            <br />
            <code>ADMIN_EMAIL=optional-bootstrap@example.com</code>
            <br />
            <code>ADMIN_PASSWORD=optional-bootstrap-password</code>
          </div>

          <div className="pre" style={{ marginTop: "1rem" }}>
            <code>{`$APP_BASE_URL/api/auth/google/login/callback`}</code>
            <br />
            <code>{`$APP_BASE_URL/api/auth/google/callback`}</code>
          </div>

          <div style={{ marginTop: "1rem" }}>
            {status.ok ? (
              <p>
                <span className="badge">Environment loaded</span>
              </p>
            ) : (
              <>
                <p>
                  <span className="badge warning">Missing variables</span>
                </p>
                <p className="muted">{status.missing.join(", ")}</p>
              </>
            )}
          </div>

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
            <Link className="button" href="/workspace">
              Open app
            </Link>
            <Link className="button secondary" href="/login">
              Sign in
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
