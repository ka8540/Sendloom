import type { RecipientOverviewDispositionCounts } from "@/lib/recipient-overview-disposition";
import type { SequenceHealthTone, SequenceMetric } from "@/components/dashboard/types";

export const SKIPPED_RECIPIENTS_HINT =
  "These recipients were excluded because their addresses were invalid, unsubscribed, or suppressed.";

export type SequenceOutcomePresentation = {
  metric: Omit<SequenceMetric, "value"> & { count: number };
  health: {
    label: string;
    tone: SequenceHealthTone;
    hint?: string;
    ariaLabel?: string;
  };
};

export function buildSequenceOutcomePresentation(
  counts: Pick<RecipientOverviewDispositionCounts, "skipped" | "needsAttention">
): SequenceOutcomePresentation {
  const metric =
    counts.needsAttention > 0
      ? {
          key: "needs-attention",
          label: "Needs attention",
          count: counts.needsAttention,
          tone: "issues" as const
        }
      : {
          key: "skipped",
          label: "Skipped",
          count: counts.skipped
        };

  if (counts.skipped > 0) {
    return {
      metric,
      health: {
        label: `${counts.skipped} skipped`,
        tone: "skipped",
        hint: SKIPPED_RECIPIENTS_HINT,
        ariaLabel: `${counts.skipped} ${counts.skipped === 1 ? "recipient was" : "recipients were"} safely skipped and require no action.`
      }
    };
  }

  if (counts.needsAttention > 0) {
    return {
      metric,
      health: {
        label: `${counts.needsAttention} ${counts.needsAttention === 1 ? "needs" : "need"} attention`,
        tone: "issues",
        ariaLabel: `${counts.needsAttention} ${counts.needsAttention === 1 ? "recipient requires" : "recipients require"} attention.`
      }
    };
  }

  return {
    metric,
    health: { label: "Clean delivery", tone: "clean" }
  };
}
