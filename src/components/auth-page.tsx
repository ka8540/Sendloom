import type { ReactNode } from "react";
import Link from "next/link";

import styles from "@/app/auth.module.css";
import { LandingNav } from "@/components/landing-nav";
import { SendloomLogo } from "@/components/sendloom-logo";

type AuthFeature = {
  body: string;
  title: string;
};

type AuthPageProps = {
  checklist: readonly string[];
  children: ReactNode;
  description: string;
  eyebrow: string;
  features: readonly AuthFeature[];
  panelDescription: string;
  panelEyebrow: string;
  panelTitle: string;
  providerError?: string;
  storyBody: string;
  storyTitle: string;
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
  checklist,
  children,
  description,
  eyebrow,
  features,
  panelDescription,
  panelEyebrow,
  panelTitle,
  providerError,
  storyBody,
  storyTitle,
  switchHref,
  switchLabel,
  switchText,
  title
}: AuthPageProps) {
  return (
    <main id="top" className={styles.page}>
      <LandingNav />

      <div className={styles.frame}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>

          <div className={styles.heroActions}>
            <Link className="button secondary" href="/">
              Back to home
            </Link>
          </div>
        </header>

        <div className={styles.layout}>
          <section className={styles.overview}>
            <article className={styles.storyCard}>
              <h2>{storyTitle}</h2>
              <p>{storyBody}</p>
            </article>

            <div className={styles.features}>
              {features.map((feature) => (
                <article key={feature.title} className={styles.featureCard}>
                  <strong>{feature.title}</strong>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>

            <article className={styles.checklistCard}>
              <h2>What happens next</h2>
              <ul className={styles.checklist}>
                {checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
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
              <span className={styles.panelEyebrow}>{panelEyebrow}</span>
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
