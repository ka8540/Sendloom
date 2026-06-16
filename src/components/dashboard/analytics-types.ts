// Shared analytics types for the Overview "Performance intelligence" section.
//
// This module is intentionally free of server-only imports (prisma, auth, env)
// so it can be imported by both the server aggregation service
// (src/services/overview-analytics.ts) and the client widgets
// (analytics-command-center.tsx) without pulling Node-only code into the
// browser bundle.

export type AnalyticsWindow = "7d" | "14d" | "30d" | "all";

export const ANALYTICS_WINDOWS: AnalyticsWindow[] = ["7d", "14d", "30d", "all"];

export const ANALYTICS_WINDOW_LABELS: Record<AnalyticsWindow, string> = {
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
  all: "All time"
};

export const ANALYTICS_WINDOW_SHORT: Record<AnalyticsWindow, string> = {
  "7d": "7D",
  "14d": "14D",
  "30d": "30D",
  all: "All"
};

export function isAnalyticsWindow(value: unknown): value is AnalyticsWindow {
  return typeof value === "string" && (ANALYTICS_WINDOWS as string[]).includes(value);
}

export type AnalyticsTrendDirection = "up" | "down" | "flat";

export type AnalyticsTrend = {
  direction: AnalyticsTrendDirection;
  label: string;
};

export type KpiTone = "accent" | "success" | "warning" | "danger" | "neutral";

export type AnalyticsKpi = {
  key: string;
  label: string;
  value: number;
  /** Pre-formatted display string (e.g. "1.2K" or "94%"). */
  display: string;
  /** Whether `value` should animate as a count-up (numbers) or render as-is (rates). */
  format: "count" | "percent";
  hint: string;
  tone: KpiTone;
  trend: AnalyticsTrend | null;
};

export type FunnelStage = {
  key: string;
  label: string;
  value: number;
  /** Width of the stage bar relative to the top of the funnel (0-100). */
  percentOfTop: number;
  /** Conversion vs the previous meaningful stage, or null when not applicable. */
  conversionFromPrev: number | null;
  tone: KpiTone;
};

export type TimelinePoint = {
  /** ISO date (start of day, UTC). */
  date: string;
  label: string;
  sent: number;
  failed: number;
  engaged: number;
};

export type SequenceHealthSlice = {
  key: string;
  label: string;
  value: number;
  tone: KpiTone;
};

export type SenderPacing = "idle" | "healthy" | "warming" | "near-limit" | "blocked" | "offline";

export type SenderUtilization = {
  senderProfileId: string;
  name: string;
  email: string;
  connected: boolean;
  sent24h: number;
  limit: number;
  remaining: number;
  utilizationPercent: number;
  pacing: SenderPacing;
  pacingLabel: string;
  activeSequences: number;
  resetAtLabel: string | null;
  ledgerAvailable: boolean;
};

export type FailureTone = "retryable" | "attention" | "recipient" | "sender" | "suppressed";

export type FailureCategory = {
  key: string;
  label: string;
  value: number;
  tone: FailureTone;
  description: string;
};

export type FailureIntelligence = {
  total: number;
  retryable: number;
  permanent: number;
  categories: FailureCategory[];
  lastFailureAt: string | null;
  lastFailureLabel: string | null;
};

export type TemplatePerformance = {
  id: string;
  name: string;
  uses: number;
  sent: number;
  opened: number;
  replied: number;
  openRate: number | null;
  lastUsedAt: string | null;
  lastUsedLabel: string | null;
};

export type ImportQuality = {
  totalImports: number;
  processed: number;
  failed: number;
  totalRows: number;
  averageRows: number;
  mappedImports: number;
  unmappedImports: number;
  mappedPercent: number | null;
  finderSearches: number;
  finderResults: number;
};

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapDay = {
  date: string;
  label: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  count: number;
  level: HeatmapLevel;
};

export type ActionTone = "attention" | "sender" | "retryable" | "import" | "neutral";

export type ActionItem = {
  key: string;
  label: string;
  detail: string;
  count: number;
  tone: ActionTone;
  href: string;
  cta: string;
};

export type OverviewAnalytics = {
  window: AnalyticsWindow;
  generatedAt: string;
  /** True when the account has no campaigns/runs/imports at all. */
  isEmpty: boolean;
  performance: {
    kpis: AnalyticsKpi[];
    audience: number;
    delivered: number;
    completionRate: number | null;
  };
  funnel: FunnelStage[];
  timeline: {
    points: TimelinePoint[];
    totals: { sent: number; failed: number; engaged: number };
    peak: number;
  };
  sequenceHealth: {
    total: number;
    slices: SequenceHealthSlice[];
  };
  senders: SenderUtilization[];
  failures: FailureIntelligence;
  templates: TemplatePerformance[];
  imports: ImportQuality;
  heatmap: {
    days: HeatmapDay[];
    total: number;
    busiestLabel: string | null;
    max: number;
  };
  actions: ActionItem[];
};
