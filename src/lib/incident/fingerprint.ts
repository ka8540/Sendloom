// Deterministic deduplication fingerprint built ONLY from safe, non-identifying
// fields. Two occurrences of the same failure (same category/feature/operation/
// code/route-template/stack/version) share a fingerprint, so repeated identical
// errors update one report instead of spamming the admin dashboard. Never include
// PII, ids, query values, or raw messages.

import { createHash } from "node:crypto";

export type FingerprintInput = {
  category: string;
  feature: string;
  operation: string;
  internalCode?: string | null;
  routeTemplate?: string | null;
  serverStackFingerprint?: string | null;
  appVersion?: string | null;
};

export function diagnosticFingerprint(input: FingerprintInput): string {
  const canonical = [
    input.category,
    input.feature,
    input.operation,
    input.internalCode ?? "",
    input.routeTemplate ?? "",
    input.serverStackFingerprint ?? "",
    input.appVersion ?? ""
  ]
    .map((part) => part.trim().toLowerCase())
    .join("|");

  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
