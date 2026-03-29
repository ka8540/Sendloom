export type SuppressionReason = "UNSUBSCRIBED" | "HARD_BOUNCE" | "COMPLAINT" | "INVALID_EMAIL" | "MANUAL_BLOCK";

export type SuppressionRecord = {
  id: string;
  email: string;
  reason: SuppressionReason;
  source: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SuppressionSortOption = "updated-desc" | "updated-asc" | "email-asc" | "reason-asc" | "source-asc";
