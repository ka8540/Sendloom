import Link from "next/link";
import { redirect } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { LoginForm } from "@/components/forms";

import { getSession } from "@/lib/auth";

export default async function LoginPage(props: { searchParams?: Promise<{ error?: string }> }) {
  const session = await getSession();
  const searchParams = await props.searchParams;

  if (session) {
    redirect("/workspace");
  }

  return (
    <main className="auth-shell">
      <div className="auth-shell__frame">
        <div className="auth-toolbar">
          <BackButton fallbackHref="/" />
        </div>
        <section className="card auth-card">
          <div className="auth-header">
            <h1>Sign in to Sendloom</h1>
            <p className="muted">Continue with Google or sign in with your email and password.</p>
          </div>
          <div className="auth-provider">
            <a className="button" href="/api/auth/google/login">
              Continue with Google
            </a>
          </div>
          {searchParams?.error ? <p className="muted">Google sign-in failed: {searchParams.error}</p> : null}
          <LoginForm />
          <p className="auth-switch">
            New to Sendloom? <Link href="/signup">Create an account</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
