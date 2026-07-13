import styles from "./overview-loading.module.css";

/**
 * Route-level loading state for the Overview dashboard. A CSS-only skeleton
 * that mirrors the real layout — hero + command card, summary cards, sequence
 * list, and activity rail — with a subtle shimmer that goes static under
 * prefers-reduced-motion. Server-rendered markup only; no client JS.
 */
export default function OverviewLoading() {
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-label="Loading your Overview">
      <span className={styles.srOnly}>Loading your Overview…</span>

      <section className={styles.hero} aria-hidden="true">
        <div className={styles.heroContent}>
          <span className={`${styles.bone} ${styles.eyebrow}`} />
          <span className={`${styles.bone} ${styles.title}`} />
          <span className={`${styles.bone} ${styles.copy}`} />
          <span className={`${styles.bone} ${styles.copyShort}`} />
          <div className={styles.highlights}>
            {[0, 1, 2].map((index) => (
              <div key={index} className={styles.highlightCard}>
                <span className={`${styles.bone} ${styles.tinyLine}`} />
                <span className={`${styles.bone} ${styles.bigNumber}`} />
                <span className={`${styles.bone} ${styles.smallLine}`} />
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actionCard}>
          <span className={`${styles.bone} ${styles.cardTitle}`} />
          <span className={`${styles.bone} ${styles.copy}`} />
          <div className={styles.ctaRow}>
            <span className={`${styles.bone} ${styles.cta}`} />
            <span className={`${styles.bone} ${styles.ctaGhost}`} />
          </div>
          <div className={styles.pulseBlock}>
            <div className={styles.pulseHead}>
              <span className={`${styles.bone} ${styles.tinyLine}`} />
              <span className={`${styles.bone} ${styles.tinyLineShort}`} />
            </div>
            <div className={styles.donutRow}>
              <span className={styles.donutRing} />
              <div className={styles.metricStack}>
                <span className={`${styles.bone} ${styles.metricBar}`} />
                <span className={`${styles.bone} ${styles.metricBar}`} />
              </div>
            </div>
            <span className={`${styles.bone} ${styles.railBar}`} />
            <div className={styles.healthCells}>
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className={`${styles.bone} ${styles.healthCell}`} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.summaryRow} aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={styles.summaryCard}>
            <div className={styles.summaryHead}>
              <span className={`${styles.bone} ${styles.iconDot}`} />
              <span className={`${styles.bone} ${styles.pill}`} />
            </div>
            <span className={`${styles.bone} ${styles.tinyLine}`} />
            <span className={`${styles.bone} ${styles.bigNumber}`} />
            <span className={`${styles.bone} ${styles.railBar}`} />
            <span className={`${styles.bone} ${styles.smallLine}`} />
          </div>
        ))}
      </section>

      <section className={styles.mainGrid} aria-hidden="true">
        <div className={styles.panel}>
          <span className={`${styles.bone} ${styles.pill}`} />
          <span className={`${styles.bone} ${styles.sectionTitle}`} />
          <span className={`${styles.bone} ${styles.copy}`} />
          <span className={`${styles.bone} ${styles.toolbar}`} />
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.rowCard}>
              <div className={styles.rowMain}>
                <span className={`${styles.bone} ${styles.rowTitle}`} />
                <div className={styles.rowChips}>
                  <span className={`${styles.bone} ${styles.chip}`} />
                  <span className={`${styles.bone} ${styles.chip}`} />
                  <span className={`${styles.bone} ${styles.chipWide}`} />
                </div>
                <span className={`${styles.bone} ${styles.railBar}`} />
              </div>
              <div className={styles.rowSide}>
                <span className={`${styles.bone} ${styles.smallLine}`} />
                <span className={`${styles.bone} ${styles.tinyLineShort}`} />
              </div>
            </div>
          ))}
        </div>

        <div className={styles.panel}>
          <span className={`${styles.bone} ${styles.pill}`} />
          <span className={`${styles.bone} ${styles.sectionTitle}`} />
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
      </section>
    </div>
  );
}
