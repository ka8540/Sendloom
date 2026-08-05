import styles from "./overview-loading.module.css";

/**
 * Route-level loading state for the Overview dashboard. A CSS-only skeleton
 * that mirrors the redesigned layout — compact header with pill actions, the
 * four-part summary strip, quick actions and recent sequence rows in the main
 * column, and the send-window + activity cards in the right column — with a
 * subtle shimmer that goes static under prefers-reduced-motion.
 * Server-rendered markup only; no client JS.
 */
export default function OverviewLoading() {
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-label="Loading your Overview">
      <span className={styles.srOnly}>Loading your Overview…</span>

      <header className={styles.pageHeader} aria-hidden="true">
        <div className={styles.pageHeading}>
          <span className={`${styles.bone} ${styles.title}`} />
          <span className={`${styles.bone} ${styles.copy}`} />
        </div>
        <div className={styles.pageActions}>
          <span className={`${styles.bone} ${styles.actionPill}`} />
          <span className={`${styles.bone} ${styles.actionPill}`} />
        </div>
      </header>

      <section className={styles.summaryStrip} aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={styles.summaryCell}>
            <div className={styles.summaryBody}>
              <span className={`${styles.bone} ${styles.tinyLine}`} />
              <span className={`${styles.bone} ${styles.statNumber}`} />
              <span className={`${styles.bone} ${styles.smallLine}`} />
            </div>
            <span className={`${styles.bone} ${styles.iconDot}`} />
          </div>
        ))}
      </section>

      <div className={styles.mainGrid} aria-hidden="true">
        <div className={styles.mainColumn}>
          <div className={styles.quickBlock}>
            <span className={`${styles.bone} ${styles.sectionTitle}`} />
            <div className={styles.quickGrid}>
              {[0, 1, 2].map((index) => (
                <div key={index} className={styles.quickCard}>
                  <span className={`${styles.bone} ${styles.iconDot}`} />
                  <div className={styles.quickLines}>
                    <span className={`${styles.bone} ${styles.smallLine}`} />
                    <span className={`${styles.bone} ${styles.tinyLine}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.sequenceBlock}>
            <div className={styles.sequenceHead}>
              <span className={`${styles.bone} ${styles.sectionTitle}`} />
              <div className={styles.sequenceTools}>
                <span className={`${styles.bone} ${styles.searchPill}`} />
                <span className={`${styles.bone} ${styles.actionPill}`} />
              </div>
            </div>
            {[0, 1, 2].map((index) => (
              <div key={index} className={styles.rowCard}>
                <span className={`${styles.bone} ${styles.iconDot}`} />
                <div className={styles.rowMain}>
                  <span className={`${styles.bone} ${styles.rowTitle}`} />
                  <div className={styles.rowChips}>
                    <span className={`${styles.bone} ${styles.chip}`} />
                    <span className={`${styles.bone} ${styles.chip}`} />
                    <span className={`${styles.bone} ${styles.chipWide}`} />
                  </div>
                </div>
                <span className={`${styles.bone} ${styles.pill}`} />
                <div className={styles.rowActions}>
                  <span className={`${styles.bone} ${styles.circle}`} />
                  <span className={`${styles.bone} ${styles.circle}`} />
                  <span className={`${styles.bone} ${styles.circle}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.sideColumn}>
          <div className={styles.sideCard}>
            <div className={styles.sideHead}>
              <span className={`${styles.bone} ${styles.smallLine}`} />
              <span className={`${styles.bone} ${styles.pill}`} />
            </div>
            <span className={`${styles.bone} ${styles.statNumber}`} />
            <span className={`${styles.bone} ${styles.tinyLine}`} />
            <span className={`${styles.bone} ${styles.meterBar}`} />
            <span className={`${styles.bone} ${styles.smallLine}`} />
          </div>

          <div className={styles.sideCard}>
            <span className={`${styles.bone} ${styles.smallLine}`} />
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={styles.activityRow}>
                <span className={`${styles.bone} ${styles.iconDot}`} />
                <div className={styles.activityLines}>
                  <span className={`${styles.bone} ${styles.smallLine}`} />
                  <span className={`${styles.bone} ${styles.tinyLine}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
