// Single source of truth that maps any eligible operational failure to a SAFE,
// normalized, product-facing error shape + the recovery actions a user may take.
//
// Pure on purpose: no env, Redis, Prisma, DOM, or React access, so the SAME
// module runs in the server (API routes / services) and the browser bundle (the
// ErrorRecoveryPanel + client normalizer). A normal user can never see an
// internal code, stack, provider name, SQL, or raw backend message — only the
// hardcoded copy below. Internal codes stay in the database / server logs / the
// admin incident dashboard for diagnostics.
//
// Modeled on src/lib/discover-public-error.ts (the existing internal->safe
// mapper pattern).

/** Eligible incident categories. Anything unmapped falls through to UNKNOWN. */
export const APP_ERROR_CATEGORIES = [
  "NETWORK_OFFLINE",
  "NETWORK_REQUEST_FAILED",
  "REQUEST_TIMEOUT",
  "SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "GMAIL_CONNECTION",
  "GMAIL_AUTHORIZATION",
  "GMAIL_SEND",
  "SEQUENCE_CREATE",
  "SEQUENCE_LAUNCH",
  "SEQUENCE_RELAUNCH",
  "IMPORT_PROCESSING",
  "TEMPLATE_SAVE",
  "DISCOVER_PROCESSING",
  "CLIENT_RENDER",
  // A report a user opened themselves from the help menu — not an auto-captured
  // failure. Kept distinct so the admin console can tell manual feedback apart
  // from real error incidents.
  "USER_REPORTED_ISSUE",
  "UNKNOWN"
] as const;

export type AppErrorCategory = (typeof APP_ERROR_CATEGORIES)[number];

/** Actions the recovery panel can offer, in canonical display order. */
export type RecoveryAction = "RETRY" | "RECONNECT_GMAIL" | "REPORT" | "GO_BACK";

export type NormalizedAppError = {
  category: AppErrorCategory;
  /** Short, user-facing heading. Never an internal code or raw message. */
  publicTitle: string;
  /** One-line, actionable, safe explanation. */
  publicMessage: string;
  /** Whether retrying the same operation could plausibly succeed. */
  retryable: boolean;
  /** Whether this failure is eligible to create an incident report. */
  reportable: boolean;
  /** Feature label, e.g. "Sequences". */
  feature: string;
  /** Operation label, e.g. "Launch sequence". */
  operation: string;
  /** Safe correlation/request id for connecting a report to server logs. */
  correlationId?: string;
  httpStatus?: number;
  /** Safe internal code for diagnostics (stored, never shown as the message). */
  internalCode?: string;
  /** ISO timestamp the failure occurred. */
  occurredAt: string;
};

type CategoryCopy = {
  title: string;
  message: string;
  retryable: boolean;
  reportable: boolean;
  /** The recovery flavor that drives the default action set. */
  flavor: "retry" | "gmail" | "terminal";
};

const CATEGORY_COPY: Record<AppErrorCategory, CategoryCopy> = {
  NETWORK_OFFLINE: {
    title: "You appear to be offline",
    message: "Reconnect to the internet, then try the action again.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  NETWORK_REQUEST_FAILED: {
    title: "We couldn't reach Sendloom",
    message: "Something interrupted the request. Check your connection, then try again.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  REQUEST_TIMEOUT: {
    title: "This is taking longer than expected",
    message: "The request timed out before it finished. Try again in a moment.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  SERVER_ERROR: {
    title: "Something went wrong",
    message: "Sendloom could not complete this action. Try again, or report the issue if it continues.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  SERVICE_UNAVAILABLE: {
    title: "Sendloom is temporarily unavailable",
    message: "This service is briefly unavailable. Try again shortly, or report the issue if it continues.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  GMAIL_CONNECTION: {
    title: "Gmail needs to be reconnected",
    message: "Reconnect the sender before continuing this action.",
    retryable: false,
    reportable: true,
    flavor: "gmail"
  },
  GMAIL_AUTHORIZATION: {
    title: "Gmail needs to be reconnected",
    message: "Your Gmail authorization has expired. Reconnect the sender before continuing this action.",
    retryable: false,
    reportable: true,
    flavor: "gmail"
  },
  GMAIL_SEND: {
    title: "We couldn't send through Gmail",
    message: "Sendloom couldn't complete the send. Try again, or report the issue if it continues.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  SEQUENCE_CREATE: {
    title: "The sequence could not be created",
    message: "Your sequence was not created. Try again — nothing was duplicated.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  SEQUENCE_LAUNCH: {
    title: "The sequence could not be started",
    message: "Your sequence was not launched. Try again without creating a duplicate run.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  SEQUENCE_RELAUNCH: {
    title: "The sequence could not be resumed",
    message: "Your sequence was not resumed. Try again without creating a duplicate run.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  IMPORT_PROCESSING: {
    title: "This import couldn't be processed",
    message: "Something interrupted processing. Try again, or report the issue if it continues.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  TEMPLATE_SAVE: {
    title: "Your template couldn't be saved",
    message: "A system error stopped the save. Your changes are still here — try again.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  DISCOVER_PROCESSING: {
    title: "We couldn't complete this search",
    message: "Something interrupted the search. Try again, or report the issue if it continues.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  CLIENT_RENDER: {
    title: "This section ran into a problem",
    message: "Reload this section to continue, or report the issue if it keeps happening.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  },
  USER_REPORTED_ISSUE: {
    // Never surfaced through the error recovery panel (a user opens this kind of
    // report deliberately, with its own dialog copy); present only so the
    // category resolves to itself instead of falling through to UNKNOWN.
    title: "Report an issue",
    message: "Tell us what went wrong on this page and we'll take a look.",
    retryable: false,
    reportable: true,
    flavor: "terminal"
  },
  UNKNOWN: {
    title: "This action could not be completed",
    message: "Something unexpected happened. Try again, or send a report so the issue can be investigated.",
    retryable: true,
    reportable: true,
    flavor: "retry"
  }
};

// Internal codes that are NORMAL product / validation outcomes, never incidents:
// empty required field, invalid input, lacking authorization, a record that
// genuinely doesn't exist, a documented limit, a duplicate where prohibited, or
// a user cancellation. These keep their normal validation messages and are NOT
// auto-reportable. Mirrors the SAFE_GRAPHQL_ERROR_CODES idea in prospect-graphql.
const NON_REPORTABLE_CODES = new Set([
  "BAD_USER_INPUT",
  "VALIDATION",
  "VALIDATION_ERROR",
  "INVALID_INPUT",
  "INVALID_SEARCH",
  "INVALID_SEARCH_INPUT",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "CONFLICT",
  "DUPLICATE",
  "ALREADY_EXISTS",
  "LIMIT_REACHED",
  "DAILY_LIMIT_REACHED",
  "DISCOVER_DAILY_LIMIT_REACHED",
  "QUOTA_EXCEEDED",
  "CANCELED",
  "CANCELLED",
  "ABORTED"
]);

/**
 * Whether an internal code represents an eligible incident (true) or a normal
 * validation / product outcome that must keep its own message and never create a
 * report (false). Unknown codes are reportable by default (a genuinely
 * unexpected failure), but an explicitly validation-shaped code is not.
 */
export function isReportableCode(code: string | null | undefined): boolean {
  if (!code) {
    return true;
  }
  return !NON_REPORTABLE_CODES.has(code.trim().toUpperCase());
}

/** Map an HTTP status to a category, or null when the status is not an incident. */
export function categoryFromHttpStatus(status: number | null | undefined): AppErrorCategory | null {
  if (!status) {
    return null;
  }
  if (status === 503) {
    return "SERVICE_UNAVAILABLE";
  }
  if (status >= 500 && status <= 599) {
    return "SERVER_ERROR";
  }
  // 4xx are normal validation / auth / not-found outcomes — not incidents.
  return null;
}

function isCategory(value: string): value is AppErrorCategory {
  return (APP_ERROR_CATEGORIES as readonly string[]).includes(value);
}

/** Resolve a raw category-ish string (or an already-normalized category). */
export function appErrorCategory(value: string | null | undefined): AppErrorCategory {
  if (!value) {
    return "UNKNOWN";
  }
  const upper = value.trim().toUpperCase();
  return isCategory(upper) ? upper : "UNKNOWN";
}

/**
 * Canonical, ordered recovery actions for a category. Pure + deterministic so it
 * is unit-testable. The panel decides the ENABLED state (e.g. Retry disabled
 * while offline or in flight, GO_BACK only when an onGoBack handler exists); this
 * only decides which actions are appropriate for the failure kind.
 *
 * - Gmail auth/connection -> Reconnect Gmail + Report (Retry won't help yet).
 * - Retryable failures      -> Try again + Report.
 * - Terminal failures       -> Report + Go back (never promise Retry will work).
 */
export function deriveRecoveryActions(
  category: AppErrorCategory,
  options: { retryable?: boolean; reportable?: boolean } = {}
): RecoveryAction[] {
  const copy = CATEGORY_COPY[category];
  const retryable = options.retryable ?? copy.retryable;
  const reportable = options.reportable ?? copy.reportable;

  const actions: RecoveryAction[] = [];

  if (copy.flavor === "gmail") {
    actions.push("RECONNECT_GMAIL");
    if (reportable) {
      actions.push("REPORT");
    }
    return actions;
  }

  if (retryable) {
    actions.push("RETRY");
    if (reportable) {
      actions.push("REPORT");
    }
    return actions;
  }

  // Terminal: do not offer Retry. Report (when eligible) then a safe exit.
  if (reportable) {
    actions.push("REPORT");
  }
  actions.push("GO_BACK");
  return actions;
}

export type NormalizeInput = {
  category?: AppErrorCategory | string | null;
  feature?: string;
  operation?: string;
  correlationId?: string | null;
  httpStatus?: number | null;
  internalCode?: string | null;
  /** Force retryable/reportable off (e.g. a known terminal failure). */
  retryable?: boolean;
  reportable?: boolean;
  occurredAt?: string;
};

/**
 * Build a fully-formed NormalizedAppError from safe inputs. Copy (title/message)
 * always comes from CATEGORY_COPY — caller-supplied raw text is never used as the
 * user-facing message, so a backend message can never leak through here.
 */
export function normalizeAppError(input: NormalizeInput): NormalizedAppError {
  const category = appErrorCategory(typeof input.category === "string" ? input.category : input.category ?? null);
  const copy = CATEGORY_COPY[category];
  const reportable = (input.reportable ?? copy.reportable) && isReportableCode(input.internalCode);
  const retryable = input.retryable ?? copy.retryable;

  return {
    category,
    publicTitle: copy.title,
    publicMessage: copy.message,
    retryable,
    reportable,
    feature: input.feature?.trim() || "Sendloom",
    operation: input.operation?.trim() || "Unknown operation",
    correlationId: input.correlationId ?? undefined,
    httpStatus: input.httpStatus ?? undefined,
    internalCode: input.internalCode ?? undefined,
    occurredAt: input.occurredAt ?? new Date().toISOString()
  };
}
