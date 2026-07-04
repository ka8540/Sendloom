import { isProductLimitExempt } from "@/lib/account-entitlements";

export const FREE_SEQUENCE_CONCURRENT_LIMIT = 10;
export const FREE_SEQUENCE_STORAGE_LIMIT = 50;

export type SequenceEntitlements = {
  maxConcurrentSequences: number | null;
  maxStoredSequences: number | null;
};

/** Resolve limits only from the trusted server-side User record. */
export function getSequenceEntitlements(user: { email?: string | null }): SequenceEntitlements {
  if (isProductLimitExempt(user)) {
    return {
      maxConcurrentSequences: null,
      maxStoredSequences: null
    };
  }

  return {
    maxConcurrentSequences: FREE_SEQUENCE_CONCURRENT_LIMIT,
    maxStoredSequences: FREE_SEQUENCE_STORAGE_LIMIT
  };
}

export function isSequenceLimitExempt(user: { email?: string | null }): boolean {
  const entitlements = getSequenceEntitlements(user);
  return entitlements.maxConcurrentSequences === null && entitlements.maxStoredSequences === null;
}
