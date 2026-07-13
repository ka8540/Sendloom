/**
 * Delivered / issues share math for the Overview Analytics Pulse.
 *
 * One pure function owns the pairing invariant the dashboard promises: the two
 * displayed percentages always describe the same whole and always sum to 100,
 * so "96% delivered" is guaranteed to appear next to "4% issues" — never a
 * lone success number. Kept free of React/DOM so it can be unit-tested as-is.
 */

export type DeliverySplit = {
  delivered: number;
  issues: number;
  /** delivered + issues — the outcomes we can actually attribute. */
  total: number;
  /** Exact shares (0–100, unrounded) for arc/bar geometry. */
  deliveredShare: number;
  issueShare: number;
  /** Rounded, complementary pair — always sums to exactly 100. */
  deliveredPercent: number;
  issuePercent: number;
  /** Display labels; sub-1% shares read "<1%" and their pair ">99%". */
  deliveredLabel: string;
  issueLabel: string;
};

/** Returns null when there is no outcome data yet (delivered + issues = 0). */
export function computeDeliverySplit(delivered: number, issues: number): DeliverySplit | null {
  const safeDelivered = Number.isFinite(delivered) ? Math.max(0, delivered) : 0;
  const safeIssues = Number.isFinite(issues) ? Math.max(0, issues) : 0;
  const total = safeDelivered + safeIssues;

  if (total <= 0) {
    return null;
  }

  const deliveredShare = (safeDelivered / total) * 100;
  const issueShare = 100 - deliveredShare;

  // Round one side and derive the other as the remainder so the pair can never
  // drift to 99 or 101. Clamp so a non-zero count never reads 0% and a side
  // with any counterpart never reads 100%.
  let issuePercent = Math.round(issueShare);
  if (safeIssues > 0 && issuePercent === 0) {
    issuePercent = 1;
  }
  if (safeIssues === 0) {
    issuePercent = 0;
  }
  if (safeDelivered > 0 && issuePercent === 100) {
    issuePercent = 99;
  }
  const deliveredPercent = 100 - issuePercent;

  let deliveredLabel = `${deliveredPercent}%`;
  let issueLabel = `${issuePercent}%`;
  if (safeIssues > 0 && issueShare < 1) {
    issueLabel = "<1%";
    deliveredLabel = ">99%";
  } else if (safeDelivered > 0 && deliveredShare < 1) {
    deliveredLabel = "<1%";
    issueLabel = ">99%";
  }

  return {
    delivered: safeDelivered,
    issues: safeIssues,
    total,
    deliveredShare,
    issueShare,
    deliveredPercent,
    issuePercent,
    deliveredLabel,
    issueLabel
  };
}
