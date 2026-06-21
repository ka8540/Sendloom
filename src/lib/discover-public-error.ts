// Single source of truth that maps INTERNAL Discover failure codes to SAFE,
// product-facing error categories + copy.
//
// Imported by BOTH the GraphQL resolver (server) and the Discover UI (client),
// so a normal user can never see an internal code (COMPANY_UNRESOLVED,
// APIFY_RUN_FAILED, PROVIDER_TIMEOUT, CACHE_REFRESH_FAILED, REDIS_LOCK_FAILED,
// …), a provider name, a stack trace, a cache key, or any other engineering
// detail. The raw internal code stays in the database / server logs / admin
// tooling for diagnostics — it is never surfaced here.
//
// Pure on purpose: no env, Redis, Prisma, DOM, or React access, so it is safe to
// run in every runtime (server resolver, edge, and the browser bundle).

/** Product-safe categories the frontend may branch on. Never an internal code. */
export const DISCOVER_PUBLIC_ERROR_CATEGORIES = [
  "COMPANY_NOT_FOUND",
  "TRY_AGAIN_LATER",
  "INVALID_SEARCH",
  "LIMIT_REACHED",
  "NOT_AVAILABLE",
  "UNKNOWN"
] as const;

export type DiscoverPublicErrorCategory = (typeof DISCOVER_PUBLIC_ERROR_CATEGORIES)[number];

export type DiscoverPublicError = {
  category: DiscoverPublicErrorCategory;
  /** Short, user-facing heading. */
  title: string;
  /** One-line, actionable, safe explanation. */
  message: string;
  /** Whether retrying the same search could plausibly succeed. */
  retryable: boolean;
};

// Internal service / provider codes -> public category. Anything NOT listed (an
// unexpected or raw error) deliberately falls through to UNKNOWN, so a new
// internal code can never leak by default.
const INTERNAL_CODE_TO_CATEGORY: Record<string, DiscoverPublicErrorCategory> = {
  // Company resolution could not anchor the company to a domain / LinkedIn URL.
  COMPANY_UNRESOLVED: "COMPANY_NOT_FOUND",
  // Transient provider / infrastructure problems — safe to retry shortly.
  PROVIDER_TIMEOUT: "TRY_AGAIN_LATER",
  PROVIDER_ERROR: "TRY_AGAIN_LATER",
  APIFY_RUN_FAILED: "TRY_AGAIN_LATER",
  CACHE_REFRESH_FAILED: "TRY_AGAIN_LATER",
  REDIS_LOCK_FAILED: "TRY_AGAIN_LATER",
  RATE_LIMITED: "TRY_AGAIN_LATER",
  NOT_CONFIGURED: "TRY_AGAIN_LATER",
  // Bad / incomplete search inputs.
  INVALID_STATE: "INVALID_SEARCH",
  INVALID_SEARCH_INPUT: "INVALID_SEARCH",
  // Ownership / existence — never reveal whether another account owns it.
  NOT_FOUND: "NOT_AVAILABLE",
  SEARCH_NOT_FOUND: "NOT_AVAILABLE",
  SEARCH_NOT_OWNED: "NOT_AVAILABLE",
  // Product rule, not an infrastructure failure.
  DISCOVER_DAILY_LIMIT_REACHED: "LIMIT_REACHED"
};

const CATEGORY_COPY: Record<DiscoverPublicErrorCategory, Omit<DiscoverPublicError, "category">> = {
  COMPANY_NOT_FOUND: {
    title: "We couldn't identify this company",
    message: "Check the company name and try again. Using the company's full legal name may help.",
    retryable: true
  },
  TRY_AGAIN_LATER: {
    title: "We couldn't complete this search",
    message: "Something interrupted the search. Please try again in a moment.",
    retryable: true
  },
  INVALID_SEARCH: {
    title: "Review the search details",
    message: "Check the company, role, and location before trying again.",
    retryable: true
  },
  LIMIT_REACHED: {
    title: "Daily limit reached",
    message: "You've used today's Discover searches. Please try again after your daily allowance resets.",
    retryable: false
  },
  NOT_AVAILABLE: {
    title: "Search unavailable",
    message: "This Discover search is no longer available.",
    retryable: false
  },
  UNKNOWN: {
    title: "Search unavailable",
    message: "We couldn't complete this search right now. Please try again.",
    retryable: true
  }
};

function isPublicCategory(value: string): value is DiscoverPublicErrorCategory {
  return (DISCOVER_PUBLIC_ERROR_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Resolve a raw internal code (or an already-mapped public category) to a public
 * category. Idempotent: passing a public category back in returns it unchanged,
 * so the client can safely re-map a value the server already sanitized.
 */
export function discoverPublicErrorCategory(code: string | null | undefined): DiscoverPublicErrorCategory {
  if (!code) {
    return "UNKNOWN";
  }
  const upper = code.trim().toUpperCase();
  if (isPublicCategory(upper)) {
    return upper;
  }
  return INTERNAL_CODE_TO_CATEGORY[upper] ?? "UNKNOWN";
}

/** Map a raw internal code (or public category) to the full safe error payload. */
export function mapDiscoverPublicError(code: string | null | undefined): DiscoverPublicError {
  const category = discoverPublicErrorCategory(code);
  return { category, ...CATEGORY_COPY[category] };
}
