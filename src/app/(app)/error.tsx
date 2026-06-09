"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { renderBrandText } from "@/components/brand-text";

const RECOVERY_WINDOW_MS = 60_000;
const MAX_AUTO_RECOVERIES = 3;

// Shared across error-boundary remounts. If a render keeps throwing, reset() makes
// this boundary remount, so a per-instance guard could loop forever. Tracking the
// recent automatic attempts at module scope caps them — this is what keeps a real,
// persistent error from turning into an infinite refresh loop while still letting
// a transient idle/network blip heal itself.
let autoRecoveryTimestamps: number[] = [];

function takeAutoRecoverySlot() {
  const now = Date.now();
  autoRecoveryTimestamps = autoRecoveryTimestamps.filter((at) => now - at < RECOVERY_WINDOW_MS);

  if (autoRecoveryTimestamps.length >= MAX_AUTO_RECOVERIES) {
    return false;
  }

  autoRecoveryTimestamps.push(now);
  return true;
}

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const recoveringRef = useRef(false);
  const [isRecovering, setIsRecovering] = useState(false);

  const runRecovery = useCallback(() => {
    if (recoveringRef.current) {
      return;
    }

    recoveringRef.current = true;
    setIsRecovering(true);
    // Re-fetch the server data for this route, then clear the boundary so the
    // segment re-renders with it — a soft recovery, never a full page reload.
    router.refresh();
    reset();
  }, [reset, router]);

  const attemptAutoRecovery = useCallback(() => {
    if (recoveringRef.current) {
      return;
    }

    // Don't fight the network: if we're offline or the tab is hidden, wait for the
    // online/visibility listener to call us back instead of burning a retry slot.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    if (!takeAutoRecoverySlot()) {
      return;
    }

    runRecovery();
  }, [runRecovery]);

  useEffect(() => {
    // Returning to an idle tab usually fires visibility/focus *before* this
    // boundary mounts, so attempt once on mount as well (still rate-limited).
    attemptAutoRecovery();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        attemptAutoRecovery();
      }
    };

    window.addEventListener("focus", attemptAutoRecovery);
    window.addEventListener("online", attemptAutoRecovery);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", attemptAutoRecovery);
      window.removeEventListener("online", attemptAutoRecovery);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [attemptAutoRecovery]);

  return (
    <main className="not-found-shell">
      <section className="card not-found-card">
        <div className="not-found-hero">
          <span className="section-kicker">
            <RefreshCw aria-hidden="true" />
            Reconnecting
          </span>
        </div>

        <div className="stack" style={{ gap: "0.55rem" }}>
          <h1>Let’s pick that back up</h1>
          <p className="muted">
            {renderBrandText(
              "Sendloom lost its connection for a moment — that usually happens after a tab sits idle. Your work is safe, and this view should come back on its own."
            )}
          </p>
        </div>

        <div className="not-found-actions">
          <button type="button" className="button" onClick={runRecovery} disabled={isRecovering}>
            {isRecovering ? <span className="button-spinner" aria-hidden="true" /> : null}
            {isRecovering ? "Reconnecting…" : "Try again"}
          </button>
          <Link className="button secondary" href="/workspace">
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
