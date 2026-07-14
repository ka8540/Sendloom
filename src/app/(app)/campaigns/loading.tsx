import styles from "./loading.module.css";

// Route-level skeleton for the Sequences dashboard. Pure CSS shimmer on a
// server component — no client JS — mirroring the real layout: the page
// header with the New sequence action, the summary cards and health panel,
// and the list below with its toolbar, five rows, and pagination.

function Bar({ className }: { className: string }) {
  return <span className={`${styles.bar} ${className}`} aria-hidden="true" />;
}

export default function CampaignsLoading() {
  return (
    <div className={styles.page} role="status" aria-busy="true">
      <span className={styles.srOnly}>Loading sequences…</span>

      <div className={styles.pageHeader}>
        <div className={styles.headingBlock}>
          <Bar className={styles.pageTitle} />
          <Bar className={styles.lede} />
        </div>
        <Bar className={styles.newButton} />
      </div>

      <div className={styles.overviewGrid}>
        <div className={styles.summaryCards}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className={styles.summaryCard}>
              <Bar className={styles.summaryLabel} />
              <Bar className={styles.summaryValue} />
            </div>
          ))}
        </div>

        <div className={styles.healthPanel}>
          <Bar className={styles.panelTitle} />
          <div className={styles.healthItem}>
            <Bar className={styles.healthLine} />
            <Bar className={styles.healthDetail} />
          </div>
          <div className={styles.healthItem}>
            <Bar className={styles.healthLine} />
            <Bar className={styles.healthDetail} />
          </div>
        </div>
      </div>

      <div className={styles.dashboard}>
        <div className={styles.toolbar}>
          <Bar className={styles.totalCount} />
          <Bar className={styles.search} />
          <div className={styles.filterRail}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Bar key={index} className={styles.filterPill} />
            ))}
          </div>
        </div>

        <Bar className={styles.rangeLine} />

        <div className={styles.list}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className={styles.row}>
              <div className={styles.rowIdentity}>
                <Bar className={styles.rowDot} />
                <div className={styles.rowTitleBlock}>
                  <Bar className={styles.rowName} />
                  <Bar className={styles.rowChip} />
                </div>
              </div>
              <Bar className={styles.rowStatus} />
              <div className={styles.rowHealth}>
                <Bar className={styles.rowValue} />
                <Bar className={styles.rowTrack} />
              </div>
              <Bar className={styles.rowAction} />
            </div>
          ))}
        </div>

        <div className={styles.paginationBar}>
          <Bar className={styles.rangeLine} />
          <div className={styles.paginationControls}>
            <Bar className={styles.pageButton} />
            <Bar className={styles.pageIndicator} />
            <Bar className={styles.pageButton} />
          </div>
        </div>
      </div>
    </div>
  );
}
