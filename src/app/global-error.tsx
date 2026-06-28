"use client";

import { useEffect, useState } from "react";

import "@/app/globals.css";
import { ReportIssueDialog } from "@/components/incident/report-issue-dialog";
import { normalizeAppError } from "@/lib/incident/app-error";
import { themeInitScript } from "@/lib/theme";

// Last-resort boundary: only renders when an error escapes every nested boundary
// (including a failure in the root layout). It must provide its own <html>/<body>.
// The report dialog is self-contained (reads the CSRF cookie directly), so
// reporting still works here even though the app providers aren't mounted.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    // Don't auto-reset out from under an open report dialog.
    if (reportOpen) {
      return;
    }
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
  }, [reset, reportOpen]);

  const error = normalizeAppError({ category: "CLIENT_RENDER", feature: "Sendloom", operation: "Load the app" });

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <main className="not-found-shell">
          <section className="card not-found-card">
            <div className="stack" style={{ gap: "0.55rem" }}>
              <h1>Let’s pick that back up</h1>
              <p className="muted">
                Something interrupted Sendloom. Your work is safe — try again to reload this view, or send a report if it
                keeps happening.
              </p>
            </div>

            <div className="not-found-actions">
              <button type="button" className="button" onClick={() => reset()}>
                Try again
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setReportOpen(true)}
                disabled={reported}
              >
                {reported ? "Reported" : "Report issue"}
              </button>
              <a className="button secondary" href="/workspace">
                Back to dashboard
              </a>
            </div>
          </section>
        </main>

        <ReportIssueDialog
          open={reportOpen}
          error={error}
          onClose={() => setReportOpen(false)}
          onReported={() => {
            setReported(true);
            setReportOpen(false);
          }}
        />
      </body>
    </html>
  );
}
