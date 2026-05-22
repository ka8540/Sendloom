"use client";

import { useRef, useState, type ComponentType } from "react";
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock,
  LoaderCircle,
  MailOpen,
  MousePointerClick,
  RefreshCw,
  TriangleAlert
} from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import type { RecipientActivityItem, RecipientActivityPage } from "@/lib/recipient-activity";
import styles from "./recipient-activity.module.css";

const STATUS_ICONS: Record<string, ComponentType<{ "aria-hidden"?: boolean }>> = {
  SENT: Check,
  OPENED: MailOpen,
  CLICKED: MousePointerClick,
  RETRYING: RefreshCw,
  FAILED: TriangleAlert,
  BOUNCED: TriangleAlert,
  COMPLAINED: TriangleAlert,
  INVALID: Ban,
  SUPPRESSED: CircleSlash,
  PENDING: Clock
};

function getStatusIcon(item: RecipientActivityItem) {
  return STATUS_ICONS[item.status] ?? Clock;
}

export function RecipientActivity({
  campaignId,
  runId,
  initialItems,
  initialPage,
  totalCount,
  pageSize
}: {
  campaignId: string;
  runId: string;
  initialItems: RecipientActivityItem[];
  initialPage: number;
  totalCount: number;
  pageSize: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  async function goToPage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page || isLoading) {
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ runId, page: String(nextPage) });
      const response = await fetch(`/api/campaigns/${campaignId}/recipient-activity?${params.toString()}`);

      if (requestId !== requestRef.current) {
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not load recipient activity.");
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as RecipientActivityPage;
      if (requestId !== requestRef.current) {
        return;
      }

      setItems(data.items);
      setPage(data.page);
      setIsLoading(false);
    } catch {
      if (requestId === requestRef.current) {
        setError("Could not load recipient activity.");
        setIsLoading(false);
      }
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.listWrap}>
        <ul
          className={`${styles.list}${isLoading ? ` ${styles.listLoading}` : ""}`}
          aria-busy={isLoading}
        >
          {items.map((item) => {
            const Icon = getStatusIcon(item);
            return (
              <li key={item.id} className={styles.row} data-tone={item.tone}>
                <div className={styles.rowMain}>
                  <span className={styles.iconTile} data-tone={item.tone} aria-hidden="true">
                    <Icon aria-hidden={true} />
                  </span>
                  <div className={styles.recipient}>
                    <span className={styles.email} title={item.email}>
                      {item.email}
                    </span>
                    <span className={styles.name}>{item.name ?? "Name unavailable"}</span>
                    {item.followUp ? (
                      <span
                        className={styles.followUpChip}
                        data-tone={item.followUp.tone}
                        title={item.followUp.message ?? undefined}
                      >
                        {item.followUp.label}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={styles.badge}
                    data-tone={item.tone}
                    data-engaged={item.engaged ? "true" : undefined}
                  >
                    {item.statusLabel}
                  </span>
                  <p className={styles.message}>{item.message}</p>
                </div>

                {item.isIssue ? (
                  <div className={styles.detailStrip} data-tone={item.tone}>
                    <span className={styles.detailFlag}>{item.retryable ? "Retryable" : "Permanent"}</span>
                    {item.attemptCount > 0 ? (
                      <span className={styles.detailItem}>Attempt {item.attemptCount}</span>
                    ) : null}
                    <span className={styles.detailItem}>
                      Last attempt&nbsp;<LocalDateTime value={item.lastAttemptAt} />
                    </span>
                    {item.nextRetryAt ? (
                      <span className={styles.detailItem}>
                        Next retry&nbsp;<LocalDateTime value={item.nextRetryAt} />
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {isLoading ? (
          <span className={styles.loadingOverlay} aria-hidden="true">
            <LoaderCircle className={styles.spinner} aria-hidden={true} />
          </span>
        ) : null}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {totalPages > 1 ? (
        <div className={styles.footer}>
          <span className={styles.countText}>
            Showing {rangeStart}–{rangeEnd} of {totalCount} recipient{totalCount === 1 ? "" : "s"}
          </span>
          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => void goToPage(page - 1)}
              disabled={page <= 1 || isLoading}
              aria-label="Previous recipient activity page"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className={styles.pageIndicator} aria-live="polite">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => void goToPage(page + 1)}
              disabled={page >= totalPages || isLoading}
              aria-label="Next recipient activity page"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
