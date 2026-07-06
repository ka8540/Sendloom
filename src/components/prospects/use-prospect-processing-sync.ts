"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isTerminalStatus,
  resolvePollDelayMs,
  resolveProcessingPhase,
  shouldPollForPhase
} from "@/components/prospects/prospect-processing";
import type { ProspectSearchStatus } from "@/components/prospects/prospect-graphql";

/**
 * Keeps the Discover processing UI in sync with the AUTHORITATIVE backend status
 * WITHOUT depending on the browser tab staying visible.
 *
 * The Discover pipeline runs server-side and records its status transitions on
 * the ProspectSearch row. This hook does not run the operation and it does not
 * own any progress value — it only *observes* the durable server state:
 *
 *   • polls `reconcile()` on a calm foreground interval while the search is
 *     non-terminal, backing off far less often when the tab is hidden;
 *   • reconciles IMMEDIATELY on visibilitychange / focus / online / pageshow so
 *     a returning user snaps to the true state instead of a stale one;
 *   • treats offline as "reconnecting" (never as failure) and resumes on
 *     `online`;
 *   • backs off exponentially on transient sync errors;
 *   • stops entirely once the backend reports a terminal status;
 *   • cleans up its timer and listeners on unmount.
 *
 * `reconcile` MUST be a status refresh only — it never starts or restarts the
 * operation, so mounting/reconnecting can't create duplicate work.
 */
export function useProspectProcessingSync(args: {
  status: ProspectSearchStatus;
  /** A start request the user just triggered is in flight. */
  starting: boolean;
  /**
   * Refresh the authoritative status from the server. Should resolve true on a
   * successful sync and false on a transient failure (used to drive backoff).
   * It must NOT throw.
   */
  reconcile: () => Promise<boolean>;
}) {
  const { status, starting, reconcile } = args;

  const readOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);
  const [online, setOnline] = useState<boolean>(readOnline);
  const [syncing, setSyncing] = useState(false);

  // Refs so the long-lived scheduler closure always sees current values without
  // re-subscribing listeners on every render.
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;
  const statusRef = useRef(status);
  statusRef.current = status;

  const errorCountRef = useRef(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // One reconcile pass. Guarded so overlapping triggers (a poll tick racing a
  // focus event) never fire two concurrent requests.
  const runSync = useCallback(async () => {
    if (inFlightRef.current || !mountedRef.current) {
      return;
    }
    if (isTerminalStatus(statusRef.current)) {
      return;
    }
    inFlightRef.current = true;
    setSyncing(true);
    let ok = false;
    try {
      ok = await reconcileRef.current();
    } catch {
      ok = false;
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setSyncing(false);
      }
    }
    errorCountRef.current = ok ? 0 : errorCountRef.current + 1;
  }, []);

  // The self-rescheduling poll loop. Uses setTimeout (not setInterval) so each
  // delay reflects the *current* hidden/backoff state, and so a slow request can
  // never stack ticks. The delay math lives in the pure module.
  const scheduleNext = useCallback(() => {
    clearTimer();
    if (!mountedRef.current) {
      return;
    }
    const phase = resolveProcessingPhase({ status: statusRef.current, starting: false, online: readOnline() });
    if (!shouldPollForPhase(phase)) {
      return;
    }
    // While offline we do not poll into a dead network; the `online` listener
    // will kick an immediate reconcile the moment connectivity returns.
    if (!readOnline()) {
      return;
    }
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const delay = resolvePollDelayMs({ hidden, errorCount: errorCountRef.current });
    timerRef.current = setTimeout(async () => {
      await runSync();
      scheduleNext();
    }, delay);
  }, [clearTimer, runSync]);

  // Immediate reconciliation shared by every "the user might have missed
  // something" signal. Resets backoff so a returning user syncs at full speed.
  const reconcileNow = useCallback(async () => {
    errorCountRef.current = 0;
    await runSync();
    scheduleNext();
  }, [runSync, scheduleNext]);

  // Drive the loop from the current status. Restarts scheduling whenever the
  // status changes (e.g. a stage advance) and tears down at terminal.
  useEffect(() => {
    mountedRef.current = true;
    if (isTerminalStatus(status)) {
      clearTimer();
      return () => {
        clearTimer();
      };
    }
    scheduleNext();
    return () => {
      clearTimer();
    };
    // scheduleNext/clearTimer are stable; re-run on status/starting change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, starting]);

  // Reconciliation triggers. These are NOT the job mechanism — they only ask the
  // server for the truth right now. Guarded internally against duplicates.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcileNow();
      } else {
        // Reschedule so the next tick uses the hidden (slow) interval.
        scheduleNext();
      }
    };
    const onFocus = () => {
      void reconcileNow();
    };
    const onOnline = () => {
      setOnline(true);
      void reconcileNow();
    };
    const onOffline = () => {
      setOnline(false);
      clearTimer();
    };
    const onPageShow = () => {
      void reconcileNow();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [clearTimer, reconcileNow, scheduleNext]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return {
    online,
    syncing,
    /** Force an immediate authoritative refresh (used by manual retry/refresh). */
    reconcileNow
  };
}
