"use client";

import { BrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";
import { BRAND, BRAND_TAGLINE, SPLASH_STAGES, SPLASH_STATUS_LABEL } from "@/components/startup-splash-core";
import { useStartupReadiness } from "@/components/use-startup-readiness";
import styles from "@/components/startup-splash.module.css";

// ---------------------------------------------------------------------------
// The splash overlay. Deliberately quiet: logo, wordmark, one status line,
// one segmented progress rail. Dismissal is readiness + wall-clock (see
// use-startup-readiness); nothing here blocks it.
// ---------------------------------------------------------------------------

export function StartupSplash() {
  const { phase, stage } = useStartupReadiness();

  if (phase === "done") {
    return null;
  }

  const stageLabel = SPLASH_STAGES[stage] ?? SPLASH_STAGES[0];

  return (
    <div
      className={styles.overlay}
      data-loader-overlay=""
      data-phase={phase}
      data-stage={stage}
      aria-busy={phase === "loading"}
    >
      {/* One soft pool of light + a vignette. Decorative, hidden from AT. */}
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.glow} />
        <div className={styles.vignette} />
      </div>

      <div className={styles.scene}>
        <span className={styles.brandLogo}>
          <SendloomLogo className={styles.brandLogoSvg} />
        </span>
        <span className={styles.markText}>
          <BrandText>{BRAND}</BrandText>
        </span>
        <span className={styles.brandTagline}>{BRAND_TAGLINE}</span>

        <p className={styles.stageCopy} role="status" aria-live="polite">
          {stageLabel}
        </p>

        <div className={styles.phaseRail} aria-hidden="true">
          {SPLASH_STAGES.map((_, index) => (
            <span key={index} className={styles.phaseTick} data-active={index <= stage ? "" : undefined} />
          ))}
        </div>
      </div>

      <span className={styles.srOnly}>{SPLASH_STATUS_LABEL}</span>
    </div>
  );
}
