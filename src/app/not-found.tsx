import Link from "next/link";

import { NotFoundDog } from "@/components/not-found-dog";

export default function NotFoundPage() {
  return (
    <main className="not-found-shell">
      <section className="card not-found-card">
        <div className="not-found-hero">
          <span className="not-found-kicker">Lost pup patrol</span>
          <NotFoundDog />
        </div>

        <div className="stack" style={{ gap: "0.55rem" }}>
          <h1>Page not found</h1>
          <p className="muted">
            This page wandered off. The good news is the rest of Sendloom is still right where it should be.
          </p>
        </div>

        <div className="not-found-actions">
          <Link className="button" href="/workspace">
            Back to dashboard
          </Link>
          <Link className="button secondary" href="/">
            Go home
          </Link>
        </div>
      </section>
    </main>
  );
}
