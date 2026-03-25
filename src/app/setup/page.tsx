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
          <p className="muted">Use this page to verify the keys you need and the redirect URLs your environment should expose.</p>

          <div className="pre">
            <code>DATABASE_URL=&lt;postgres connection string&gt;</code>
            <br />
            <code>REDIS_URL=&lt;redis connection string&gt;</code>
            <br />
            <br />
            <code>SESSION_SECRET=&lt;32+ character secret&gt;</code>
            <br />
            <br />
            <code>MAIL_PROVIDER=gmail</code>
            <br />
            <code>GOOGLE_CLIENT_ID=&lt;google oauth client id&gt;</code>
            <br />
            <code>GOOGLE_CLIENT_SECRET=&lt;google oauth client secret&gt;</code>
            <br />
            <br />
            <code>APP_BASE_URL=&lt;app base url&gt;</code>
            <br />
            <br />
            <code>ADMIN_EMAIL=&lt;optional bootstrap admin email&gt;</code>
            <br />
            <code>ADMIN_PASSWORD=&lt;optional bootstrap admin password&gt;</code>
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
