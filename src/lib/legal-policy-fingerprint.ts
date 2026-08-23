import { createHash } from "node:crypto";

import type { LegalPolicy } from "@/lib/legal-policies";

/**
 * Integrity fingerprint for the public policy text and meaningful display
 * metadata. Version and changeSummary are deliberately excluded: changing
 * either cannot disguise an unchanged or accidentally edited policy body.
 */
export function computeLegalPolicyContentHash(policy: LegalPolicy) {
  const canonicalContent = JSON.stringify({
    id: policy.id,
    title: policy.title,
    path: policy.path,
    lastUpdated: policy.lastUpdated,
    sections: policy.sections
  });

  return createHash("sha256").update(canonicalContent, "utf8").digest("hex");
}
