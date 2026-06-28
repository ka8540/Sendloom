"use client";

import { normalizeAppError } from "@/lib/incident/app-error";

import { ErrorRecoveryPanel } from "./error-recovery-panel";

/**
 * Inline recovery surface for a failed Gmail reconnect/authorization (the
 * `?gmail_error=` return). Offers Reconnect Gmail (to the specific sender) + a
 * Report option, instead of a transient toast, since a reconnect failure is an
 * actionable operational incident.
 */
export function GmailReconnectNotice({ reconnectHref }: { reconnectHref: string }) {
  const error = normalizeAppError({
    category: "GMAIL_AUTHORIZATION",
    feature: "Gmail",
    operation: "Reconnect sender"
  });
  return <ErrorRecoveryPanel error={error} variant="card" reconnectHref={reconnectHref} />;
}
