import styles from "./loading.module.css";

// Route-level loading state for the Sequences command center. Pure CSS
// skeletons mirroring the real layout — header, filter/search bar, five
// sequence cards, the inspector panel, and pagination — so the page never
// shifts when data arrives. No spinners; reduced motion disables the shimmer.
export default function CampaignsLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading sequences">
      <header className={styles.hero}>
        <div>
          <div className={`${styles.bone} ${styles.title}`} />
          <div className={`${styles.bone} ${styles.subtitle}`} />
        </div>
        <div className={`${styles.bone} ${styles.cta}`} />
      </header>

      <section className={styles.board}>
        <div className={styles.commandBar}>
          <div className={styles.filterRail}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={`${styles.bone} ${styles.pill}`} />
            ))}
          </div>
          <div className={`${styles.bone} ${styles.search}`} />
        </div>

        <div className={`${styles.bone} ${styles.rangeLine}`} />

        <div className={styles.boardGrid}>
          <div className={styles.queue}>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className={styles.card}>
                <div className={styles.cardBody}>
                  <div className={styles.cardTop}>
                    <div className={`${styles.bone} ${styles.dot}`} />
                    <div className={`${styles.bone} ${styles.cardName}`} />
                    <div className={`${styles.bone} ${styles.cardPill}`} />
                  </div>
                  <div className={styles.cardChips}>
                    <div className={`${styles.bone} ${styles.chip}`} />
                    <div className={`${styles.bone} ${styles.chip}`} />
                  </div>
                  <div className={`${styles.bone} ${styles.rail}`} />
                </div>
                <div className={styles.cardActions}>
                  <div className={`${styles.bone} ${styles.action}`} />
                  <div className={`${styles.bone} ${styles.action}`} />
                </div>
              </div>
            ))}

            <div className={styles.pagination}>
              <div className={`${styles.bone} ${styles.action}`} />
              <div className={`${styles.bone} ${styles.pageLabel}`} />
              <div className={`${styles.bone} ${styles.action}`} />
            </div>
          </div>

          <aside className={styles.inspector}>
            <div className={styles.inspectorHead}>
              <div className={`${styles.bone} ${styles.inspectorTitle}`} />
              <div className={`${styles.bone} ${styles.cardPill}`} />
            </div>
            <div className={styles.inspectorPulse}>
              <div className={`${styles.bone} ${styles.ring}`} />
              <div className={styles.legend}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`${styles.bone} ${styles.legendRow}`} />
                ))}
              </div>
            </div>
            <div className={`${styles.bone} ${styles.rail}`} />
            <div className={styles.factGrid}>
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className={styles.fact}>
                  <div className={`${styles.bone} ${styles.factLabel}`} />
                  <div className={`${styles.bone} ${styles.factValue}`} />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
