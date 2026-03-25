import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms";

import { getSession } from "@/lib/auth";

export default async function LoginPage(props: { searchParams?: Promise<{ error?: string }> }) {
  const session = await getSession();
  const searchParams = await props.searchParams;

  if (session) {
    redirect("/workspace");
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem", background: "var(--bg)" }}>
      <section className="card" style={{ width: "min(520px, 100%)" }}>
        <h1 style={{ marginTop: 0 }}>Sign in to Sendloom</h1>
        <p className="muted">Continue with Google or sign in with email.</p>
        <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
          <a className="button" href="/api/auth/google/login">
            Continue with Google
          </a>
        </div>
        {searchParams?.error ? <p className="muted">Google sign-in failed: {searchParams.error}</p> : null}
        <LoginForm />
      </section>
    </main>
  );
}
