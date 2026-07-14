import styles from "./loading.module.css";

// Route-level skeleton for the Sequences page. Pure CSS shimmer on a server
// component — no client JS — mirroring the real layout: the create form on
// the left, the compact sender panel on the right, and the dashboard below
// with its header, filter rail, search, five rows, and pagination.

function Bar({ className }: { className: string }) {
  return <span className={`${styles.bar} ${className}`} aria-hidden="true" />;
}

export default function CampaignsLoading() {
  return (
    <div className={styles.page} role="status" aria-busy="true">
      <span className={styles.srOnly}>Loading sequences…</span>

      <div className={styles.topGrid}>
        <div className={styles.builderCard}>
          <Bar className={styles.kicker} />
          <Bar className={styles.pageTitle} />
          <Bar className={styles.lede} />
          <div className={styles.formFields}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={styles.formField}>
                <Bar className={styles.fieldLabel} />
                <Bar className={styles.fieldInput} />
              </div>
            ))}
          </div>
          <Bar className={styles.submit} />
        </div>

        <div className={styles.senderPanel}>
          <Bar className={styles.kicker} />
          <Bar className={styles.panelTitle} />
          <div className={styles.senderRow}>
            <Bar className={styles.senderIcon} />
            <div className={styles.senderMeta}>
              <Bar className={styles.senderName} />
              <Bar className={styles.senderEmail} />
            </div>
            <Bar className={styles.senderChip} />
          </div>
          <Bar className={styles.connectButton} />
        </div>
      </div>

      <div className={styles.dashboard}>
        <div className={styles.dashboardHeader}>
          <div className={styles.headingBlock}>
            <Bar className={styles.kicker} />
            <Bar className={styles.sectionTitle} />
            <Bar className={styles.lede} />
          </div>
          <Bar className={styles.summaryStrip} />
        </div>

        <div className={styles.toolbar}>
          <div className={styles.filterRail}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Bar key={index} className={styles.filterPill} />
            ))}
          </div>
          <Bar className={styles.search} />
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
              <div className={styles.rowHealth}>
                <Bar className={styles.rowValue} />
                <Bar className={styles.rowTrack} />
              </div>
              <Bar className={styles.rowStatus} />
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
