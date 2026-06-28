// Server-derived incident severity. The client NEVER chooses severity — it is
// computed from the safe category + how often the same failure has recurred.
// Rules follow the spec: widespread/recurring outages and data-integrity-ish
// failures are Critical/High; isolated retryable failures are Medium; cosmetic
// client warnings are Low.

import type { AppErrorCategory } from "@/lib/incident/app-error";

export const INCIDENT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export function deriveSeverity(category: AppErrorCategory, occurrenceCount = 1): IncidentSeverity {
  const persistent = occurrenceCount >= 3;
  const repeated = occurrenceCount >= 5;

  switch (category) {
    // Backend outages: escalate as they recur (single feature -> widespread).
    case "SERVER_ERROR":
    case "SERVICE_UNAVAILABLE":
      return repeated ? "CRITICAL" : persistent ? "HIGH" : "MEDIUM";

    // Gmail cannot reconnect / authorize: High once it persists.
    case "GMAIL_CONNECTION":
    case "GMAIL_AUTHORIZATION":
      return persistent ? "HIGH" : "MEDIUM";

    // Sequence create/launch/relaunch consistently failing is High.
    case "SEQUENCE_CREATE":
    case "SEQUENCE_LAUNCH":
    case "SEQUENCE_RELAUNCH":
      return persistent ? "HIGH" : "MEDIUM";

    // Other feature failures: High only when they repeat.
    case "GMAIL_SEND":
    case "IMPORT_PROCESSING":
    case "TEMPLATE_SAVE":
    case "DISCOVER_PROCESSING":
      return repeated ? "HIGH" : "MEDIUM";

    // Recoverable transport failures.
    case "NETWORK_OFFLINE":
    case "NETWORK_REQUEST_FAILED":
    case "REQUEST_TIMEOUT":
      return "MEDIUM";

    // Cosmetic / contained client render error.
    case "CLIENT_RENDER":
      return repeated ? "MEDIUM" : "LOW";

    case "UNKNOWN":
    default:
      return persistent ? "HIGH" : "MEDIUM";
  }
}
