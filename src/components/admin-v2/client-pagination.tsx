"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./admin-ui.module.css";

export function AdminClientPagination({
  page,
  pageSize,
  count,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const first = count ? (page - 1) * pageSize + 1 : 0;
  return (
    <nav className={styles.pagination} aria-label="History pages">
      <span>
        Showing {first.toLocaleString()}–
        {Math.min(page * pageSize, count).toLocaleString()} of{" "}
        {count.toLocaleString()}
      </span>
      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.pagerButton}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} /> Previous
        </button>
        <strong>
          Page {page} of {pages}
        </strong>
        <button
          type="button"
          className={styles.pagerButton}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
