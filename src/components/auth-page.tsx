import type { ReactNode } from "react";
import Link from "next/link";

import styles from "@/app/auth.module.css";
import { AnimatedEmailPath } from "@/components/AnimatedEmailPath";
import { AuthVideoPreview } from "@/components/auth-video-preview";
import { BackButton } from "@/components/back-button";
import { SendloomLogo } from "@/components/sendloom-logo";

type AuthPageProps = {
  children: ReactNode;
  description: string;
  eyebrow: string;
  panelDescription: string;
  panelTitle: string;
  providerError?: string;
  switchHref: "/login" | "/signup";
  switchLabel: string;
  switchText: string;
  title: string;
};

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
  panelDescription,
  panelTitle,
  providerError,
  switchHref,
  switchLabel,
  switchText,
  title
}: AuthPageProps) {
  return (
    <main id="top" className={styles.page}>
      <AnimatedEmailPath />

      <div className={styles.frame}>
        <div className={styles.topBar}>
          <BackButton alwaysUseFallback className={styles.backButton} fallbackHref="/" label="Back to home" />
        </div>

        <header className={styles.hero}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </header>

        <div className={styles.layout}>
          <section className={styles.visual} aria-label="Product preview">
            <div className={styles.visualShell}>
              {/* Layer order: shell accents, centered preview, then compact supporting cards. */}
              <div className={styles.visualStage}>
                <div className={styles.visualFrame}>
                  <article className={`${styles.visualNote} ${styles.visualNoteLeft}`}>
                    <span className={styles.visualNoteEyebrow}>Sequence ready</span>
                    <strong>Map the send before you log in.</strong>
                    <p>Timing, sender state, and templates stay in view.</p>
                  </article>

                  <div className={styles.visualVideoWrap}>
                    <AuthVideoPreview />
                  </div>

                  <article className={`${styles.visualNote} ${styles.visualNoteRight}`}>
                    <span className={styles.visualNoteEyebrow}>Quick preview</span>
                    <strong>See the workflow in one pass.</strong>
                    <p>Imports, writing, and launch steps at a glance.</p>
                  </article>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTop}>
              <SendloomLogo className={styles.panelLogo} />
              <div className={styles.panelBrand}>
                <strong>Sendloom</strong>
                <span>Sequence operations with real sending discipline.</span>
              </div>
            </div>

            <div className={styles.panelHeader}>
              <h2>{panelTitle}</h2>
              <p>{panelDescription}</p>
            </div>

            <a className={styles.providerButton} href="/api/auth/google/login">
              <GoogleIcon />
              Continue with Google
            </a>

            {providerError ? <p className={styles.error}>Google sign-in failed: {providerError}</p> : null}

            <div className={styles.divider}>
              <span>or continue with email</span>
            </div>

            <div className={styles.formWrap}>{children}</div>

            <p className={styles.switch}>
              {switchText} <Link href={switchHref}>{switchLabel}</Link>
            </p>

            <p className={styles.legal}>
              By continuing, you agree to the <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy
              Policy</Link>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
