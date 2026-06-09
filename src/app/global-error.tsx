"use client";

import { useEffect } from "react";

import "@/app/globals.css";
import { themeInitScript } from "@/lib/theme";

// Last-resort boundary: only renders when an error escapes every nested boundary
// (including a failure in the root layout). It must provide its own <html>/<body>.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reset();
      }
    };

    // Coming back to the tab is the strongest "try again" signal we have here.
    window.addEventListener("focus", reset);
    window.addEventListener("online", reset);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", reset);
      window.removeEventListener("online", reset);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reset]);

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <main className="not-found-shell">
          <section className="card not-found-card">
            <div className="stack" style={{ gap: "0.55rem" }}>
              <h1>Let’s pick that back up</h1>
              <p className="muted">
                Something interrupted Sendloom. Your work is safe — try again to reload this view.
              </p>
            </div>

            <div className="not-found-actions">
              <button type="button" className="button" onClick={() => reset()}>
                Try again
              </button>
              <a className="button secondary" href="/workspace">
                Back to dashboard
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
