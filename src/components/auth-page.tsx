import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, Gauge, Mail, ShieldCheck, Workflow } from "lucide-react";
import Link from "next/link";

import styles from "@/app/auth.module.css";
import { AnimatedEmailPath } from "@/components/AnimatedEmailPath";
import { AuthPointerFX } from "@/components/auth-pointer-fx";
import { AuthVideoPreview } from "@/components/auth-video-preview";
import { BrandText, renderBrandText } from "@/components/brand-text";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { SendloomLogo } from "@/components/sendloom-logo";

type AuthPageProps = {
  children: ReactNode;
  description: string;
  eyebrow: string;
  /* Strips the decorative layer (floating cards, status chips, brand tags)
     and renders the calm two-column variant. Login only — signup keeps the
     full treatment. */
  minimal?: boolean;
  panelDescription: string;
  panelTitle: string;
  providerError?: string;
  switchHref: "/login" | "/signup";
  switchLabel: string;
  switchText: string;
  title: string;
};

const STATUS_CHIPS = [
  { Icon: Mail, label: "Gmail-ready" },
  { Icon: Gauge, label: "Safe pacing" },
  { Icon: Workflow, label: "Sequence workspace" },
  { Icon: ShieldCheck, label: "OAuth secured" }
] as const;

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.25h2.9c1.7-1.56 2.7-3.86 2.7-6.61Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.9-2.25c-.8.54-1.84.86-3.06.86-2.35 0-4.35-1.58-5.06-3.71H.96v2.32A8.99 8.99 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.94 10.71A5.4 5.4 0 0 1 3.66 9c0-.6.1-1.18.28-1.71V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.03l2.98-2.32Z"
        fill="#FBBC04"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.43 1.33l2.57-2.57C13.46.9 11.42 0 9 0A8.99 8.99 0 0 0 .96 4.97l2.98 2.32C4.65 5.16 6.65 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function AuthPage({
  children,
  description,
  eyebrow,
  minimal = false,
  panelDescription,
  panelTitle,
  providerError,
  switchHref,
  switchLabel,
  switchText,
  title
}: AuthPageProps) {
  return (
    <main id="top" className={minimal ? `${styles.page} ${styles.pageMinimal}` : styles.page}>
      <span id="main-content" />
      <AuthPointerFX />
      <AnimatedEmailPath />

      <div className={styles.orbits} aria-hidden="true">
        <span className={styles.orbitRing} />
        <span className={`${styles.orbitRing} ${styles.orbitRingTwo}`} />
        <span className={`${styles.orbitRing} ${styles.orbitRingThree}`} />
      </div>

      <Link className={styles.backHome} href="/" aria-label="Back to home">
        <ArrowLeft aria-hidden="true" />
        <span>Back to home</span>
      </Link>

      <div className={styles.frame}>
        <section className={styles.showcase} data-parallax="6" aria-label="Sendloom preview">
          <span className={styles.showcaseGlow} aria-hidden="true" />

          <header className={styles.showcaseHead}>
            <div className={styles.brandLockup}>
              <SendloomLogo className={styles.brandMark} />
              <span className={styles.brandName}>
                <BrandText>Sendloom</BrandText>
              </span>
              {minimal ? null : <span className={styles.brandTag}>Command center</span>}
            </div>

            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1 className={styles.title}>{renderBrandText(title)}</h1>
            <p className={styles.description}>{renderBrandText(description)}</p>
          </header>

          <div className={styles.stage}>
            {minimal ? null : (
              <article className={`${styles.floatCard} ${styles.floatCardLeft}`} data-parallax="14">
                <span className={styles.floatCardEyebrow}>Sequence ready</span>
                <strong>Map the send before you log in.</strong>
                <p>Timing, sender state, and templates stay in view.</p>
              </article>
            )}

            <div className={styles.videoFrame}>
              <AuthVideoPreview />
            </div>

            {minimal ? null : (
              <article className={`${styles.floatCard} ${styles.floatCardRight}`} data-parallax="18">
                <span className={styles.floatCardEyebrow}>Quick preview</span>
                <strong>See the workflow in one pass.</strong>
                <p>Import, template, launch, and track at a glance.</p>
              </article>
            )}
          </div>

          {minimal ? null : (
            <ul className={styles.chips}>
              {STATUS_CHIPS.map(({ Icon, label }, index) => (
                <li
                  key={label}
                  className={styles.chip}
                  style={{ "--chip-index": String(index) } as CSSProperties}
                >
                  <span className={styles.chipIcon}>
                    <Icon aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel} data-card-fx aria-label={panelTitle}>
          {providerError ? <ErrorToastOnMount message={providerError} title="Google sign-in failed" /> : null}

          <span className={styles.panelBorder} aria-hidden="true" />
          <span className={styles.panelSpot} aria-hidden="true" />

          <div className={styles.panelInner}>
            <div className={styles.panelTop}>
              <SendloomLogo className={styles.panelLogo} />
              <div className={styles.panelBrand}>
                <strong>
                  <BrandText>Sendloom</BrandText>
                </strong>
                {/* Redundant in the minimal variant: the brand block on the
                    left already carries the product context. */}
                {minimal ? null : <span>Sequence operations with real sending discipline.</span>}
              </div>
            </div>

            <div className={styles.panelHeader}>
              <h2>{renderBrandText(panelTitle)}</h2>
              <p>{renderBrandText(panelDescription)}</p>
            </div>

            <a className={styles.providerButton} href="/api/auth/google/login">
              <GoogleIcon />
              Continue with Google
            </a>

            <div className={styles.divider}>
              <span>or continue with email</span>
            </div>

            <div className={styles.formWrap}>{children}</div>

            <p className={styles.switch}>
              {renderBrandText(switchText)} <Link href={switchHref}>{renderBrandText(switchLabel)}</Link>
            </p>

            <p className={styles.legal}>
              By continuing, you agree to the <Link href="/terms">Terms of Service</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
