// Shared types for the Overview "Needs attention" section.
//
// This module is intentionally free of server-only imports (prisma, auth, env)
// so it can be imported by both the server aggregation service
// (src/services/overview-analytics.ts) and the client/server widgets
// (needs-attention-panel.tsx) without pulling Node-only code into the browser
// bundle.

export type FailureTone = "retryable" | "attention" | "recipient" | "sender";

export type FailureCategory = {
  key: string;
  label: string;
  value: number;
  tone: FailureTone;
  description: string;
};

export type FailureIntelligence = {
  /** Retryable + permanent. */
  total: number;
  /** Jobs queued for an automatic retry. */
  retryable: number;
  /** Jobs that failed for good and need a person to act. */
  permanent: number;
  categories: FailureCategory[];
  lastFailureAt: string | null;
  lastFailureLabel: string | null;
};

export type ActionTone = "attention" | "sender" | "retryable" | "import";

export type ActionItem = {
  key: string;
  label: string;
  detail: string;
  count: number;
  tone: ActionTone;
  href: string;
  cta: string;
};

export type OverviewAttention = {
  generatedAt: string;
  /** True when the account has at least one campaign, recipient, or import. */
  hasData: boolean;
  /** Prioritized list of things the operator should act on right now. */
  actions: ActionItem[];
  /** Delivery failure breakdown (retryable vs action-required). */
  failures: FailureIntelligence;
};
