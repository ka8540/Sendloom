import Link from "next/link";

import styles from "@/app/legal.module.css";
import { SendloomLogo } from "@/components/sendloom-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

type LegalHighlight = {
  detail: string;
  label: string;
  value: string;
};

type LegalQuickFact = {
  body: string;
  title: string;
};

type LegalSection = {
  bullets?: readonly string[];
  id: string;
  note?: string;
  paragraphs?: readonly string[];
  title: string;
};

type LegalPageProps = {
  activePage: "privacy" | "terms";
  commitments: readonly string[];
  ctaBody: string;
  ctaTitle: string;
  description: string;
  eyebrow: string;
  footerCopy: string;
  guideBody: string;
  guideTitle: string;
  highlights: readonly LegalHighlight[];
  lastUpdated: string;
  quickFacts: readonly LegalQuickFact[];
  relatedHref: "/privacy" | "/terms";
  relatedLabel: string;
  sectionBody: string;
  sectionEyebrow: string;
  sectionTitle: string;
  sections: readonly LegalSection[];
  title: string;
  visualBody: string;
  visualPoints: readonly LegalQuickFact[];
  visualTitle: string;
};

function getNavLinkClass(active: boolean) {
  return `${styles.navLink}${active ? ` ${styles.navLinkActive}` : ""}`;
}

export function LegalPage({
  activePage,
  commitments,
  ctaBody,
  ctaTitle,
  description,
  eyebrow,
  footerCopy,
  guideBody,
  guideTitle,
  highlights,
  lastUpdated,
  quickFacts,
  relatedHref,
  relatedLabel,
  sectionBody,
  sectionEyebrow,
  sectionTitle,
  sections,
  title,
  visualBody,
  visualPoints,
  visualTitle
}: LegalPageProps) {
  const titleWords = title.split(" ");
  const titleAccent = titleWords.at(-1) ?? title;
  const titlePrefix = titleWords.slice(0, -1).join(" ");

  return (
    <main id="top" className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.nav}>
          <div className={styles.navInner}>
            <Link className={styles.brand} href="/">
              <SendloomLogo className={styles.brandMark} />
              <div className={styles.brandText}>
                <strong>Sendloom</strong>
                <span>Sequence operations with real sending discipline.</span>
              </div>
            </Link>

            <nav className={styles.navLinks} aria-label="Legal navigation">
              <Link className={getNavLinkClass(false)} href="/">
                Home
              </Link>
              <Link className={getNavLinkClass(activePage === "privacy")} href="/privacy">
                Privacy
              </Link>
              <Link className={getNavLinkClass(activePage === "terms")} href="/terms">
                Terms
              </Link>
              <a className={getNavLinkClass(false)} href="mailto:ka8540@g.rit.edu">
                Contact
              </a>
            </nav>

            <div className={styles.actions}>
              <ThemeSwitcher className={styles.themeMenu} />
              <Link className={styles.ghostButton} href="/login">
                Login
              </Link>
              <Link className={styles.primaryButton} href="/signup">
                Try it
              </Link>
            </div>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>{eyebrow}</div>
            <div className={styles.metaBadge}>Last updated: {lastUpdated}</div>
            <h1 className={styles.headline}>
              {titlePrefix ? `${titlePrefix} ` : null}
              <span className={styles.headlineAccent}>{titleAccent}</span>
            </h1>
            <p className={styles.lede}>{description}</p>

            <div className={styles.ctaRow}>
              <Link className={styles.buttonLink} href="/">
                Back to home
              </Link>
              <Link className={styles.buttonLinkSecondary} href={relatedHref}>
                {relatedLabel}
              </Link>
            </div>

            <div className={styles.highlightGrid}>
              {highlights.map((highlight) => (
                <article key={highlight.label} className={styles.highlightCard}>
                  <span className={styles.highlightLabel}>{highlight.label}</span>
                  <strong className={styles.highlightValue}>{highlight.value}</strong>
                  <span className={styles.highlightDetail}>{highlight.detail}</span>
                </article>
              ))}
            </div>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.visualPanel}>
              <div className={styles.visualHeader}>
                <span className={styles.visualEyebrow}>At a glance</span>
                <h2 className={styles.visualTitle}>{visualTitle}</h2>
                <p className={styles.visualText}>{visualBody}</p>
              </div>

              <div className={styles.visualCenter}>
                <div className={styles.visualBadge}>
                  <SendloomLogo className={styles.visualBadgeLogo} />
                  <span className={styles.visualBadgeText}>
                    Clear sending rules, clear data boundaries, and clear expectations before anything goes live.
                  </span>
                </div>
              </div>

              <div className={styles.visualGrid}>
                {visualPoints.map((item) => (
                  <article key={item.title} className={styles.visualCard}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.belt}>
          {quickFacts.map((fact) => (
            <article key={fact.title} className={styles.beltCard}>
              <strong>{fact.title}</strong>
              <span>{fact.body}</span>
            </article>
          ))}
        </section>

        <section className={styles.contentSection}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>{sectionEyebrow}</p>
            <h2 className={styles.sectionTitle}>{sectionTitle}</h2>
            <p className={styles.sectionText}>{sectionBody}</p>
          </div>

          <div className={styles.contentGrid}>
            <aside className={styles.summaryPanel}>
              <h3 className={styles.summaryTitle}>{guideTitle}</h3>
              <p className={styles.summaryText}>{guideBody}</p>

              <div className={styles.commitments}>
                {commitments.map((commitment) => (
                  <div key={commitment} className={styles.commitment}>
                    <span className={styles.commitmentDot} aria-hidden="true" />
                    <span>{commitment}</span>
                  </div>
                ))}
              </div>

              <nav className={styles.contentsNav} aria-label="Policy sections">
                {sections.map((section) => (
                  <a key={section.id} className={styles.contentsLink} href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <div className={styles.sectionStack}>
              {sections.map((section, index) => (
                <article key={section.id} id={section.id} className={styles.sectionCard}>
                  <div className={styles.sectionCardHeader}>
                    <span className={styles.sectionIndex}>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{section.title}</h3>
                  </div>

                  <div className={styles.sectionBody}>
                    {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}

                    {section.bullets ? (
                      <ul className={styles.bulletList}>
                        {section.bullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}

                    {section.note ? <p className={styles.sectionNote}>{section.note}</p> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.ctaSection}>
          <article className={styles.ctaPanel}>
            <h2>{ctaTitle}</h2>
            <p>{ctaBody}</p>

            <div className={styles.ctaActions}>
              <Link className={styles.buttonLink} href="/signup">
                Try Sendloom
              </Link>
              <Link className={styles.buttonLinkSecondary} href={relatedHref}>
                {relatedLabel}
              </Link>
            </div>
          </article>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrandBlock}>
              <div className={styles.footerBrand}>
                <SendloomLogo className={styles.footerBrandMark} />
                <div>
                  <strong>Sendloom</strong>
                  <span>Outreach operations with one source of truth.</span>
                </div>
              </div>
              <p className={styles.footerCopy}>{footerCopy}</p>
            </div>

            <div className={styles.footerColumns}>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Pages</span>
                <Link href="/">Home</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
              </div>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Access</span>
                <Link href="/login">Login</Link>
                <Link href="/signup">Try Sendloom</Link>
                <a href="mailto:ka8540@g.rit.edu">Contact</a>
              </div>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Trust</span>
                <a href="#top">Top</a>
                <a href={`#${sections[0]?.id ?? ""}`}>Start reading</a>
                <Link href={relatedHref}>{relatedLabel}</Link>
              </div>
            </div>
          </div>

          <div className={styles.footerBottom}>
            <p className={styles.footerCopy}>Last updated {lastUpdated}. Questions go to ka8540@g.rit.edu.</p>
            <div className={styles.footerLinks}>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Service</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
