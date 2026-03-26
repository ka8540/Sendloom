import Link from "next/link";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { SignupForm } from "@/components/forms";
import { getSession } from "@/lib/auth";

export default async function SignupPage() {
  const session = await getSession();

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
            <h1>Create your account</h1>
            <p className="muted">Sign up with Google or create an email/password account and jump straight into the dashboard.</p>
          </div>
          <div className="auth-provider">
            <a className="button" href="/api/auth/google/login">
              Continue with Google
            </a>
          </div>
          <SignupForm />
          <p className="auth-switch">
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
