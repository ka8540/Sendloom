import Link from "next/link";

import styles from "@/app/legal.module.css";
import { renderBrandText } from "@/components/brand-text";
import { LandingNav } from "@/components/landing-nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

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
  commitments: readonly string[];
  description: string;
  eyebrow: string;
  guideBody: string;
  guideTitle: string;
  highlights: readonly LegalHighlight[];
  lastUpdated: string;
  quickFacts: readonly LegalQuickFact[];
  relatedHref: "/abuse" | "/privacy" | "/terms";
  relatedLabel: string;
  sectionBody: string;
  sectionEyebrow: string;
  sectionTitle: string;
  sections: readonly LegalSection[];
  title: string;
};

const legalNavItems = [
  { href: "/", label: "Home" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/abuse", label: "Abuse" },
  { href: "mailto:ka8540@g.rit.edu", label: "Contact" }
] as const;

export function LegalPage({
  commitments,
  description,
  eyebrow,
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
  title
}: LegalPageProps) {
  return (
    <main id="top" className={styles.page}>
      <span id="main-content" />
      <LandingNav items={legalNavItems} />

      <div className={styles.frame}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <span className={styles.meta}>Last updated: {lastUpdated}</span>
          <h1 className={styles.title}>{renderBrandText(title)}</h1>
          <p className={styles.description}>{renderBrandText(description)}</p>

          <div className={styles.heroActions}>
            <Link className="button" href="/">
              Back to home
            </Link>
            <Link className="button secondary" href={relatedHref}>
              {relatedLabel}
            </Link>
          </div>

          <div className={styles.quickFacts}>
            {quickFacts.map((fact) => (
              <article key={fact.title} className={styles.quickFactCard}>
                <strong>{fact.title}</strong>
                <span>{renderBrandText(fact.body)}</span>
              </article>
            ))}
          </div>
        </header>

        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <section className={styles.sidebarCard}>
              <h2 className={styles.sidebarTitle}>{guideTitle}</h2>
              <p className={styles.sidebarText}>{renderBrandText(guideBody)}</p>
            </section>

            <section className={styles.sidebarCard}>
              <h2 className={styles.sidebarTitle}>On this page</h2>
              <nav className={styles.contents} aria-label="Policy sections">
                {sections.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {renderBrandText(section.title)}
                  </a>
                ))}
              </nav>
            </section>

            <section className={styles.sidebarCard}>
              <h2 className={styles.sidebarTitle}>Key points</h2>
              <div className={styles.highlights}>
                {highlights.map((highlight) => (
                  <article key={highlight.label} className={styles.highlight}>
                    <span className={styles.highlightLabel}>{highlight.label}</span>
                    <strong className={styles.highlightValue}>{highlight.value}</strong>
                    <p className={styles.highlightDetail}>{renderBrandText(highlight.detail)}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.sidebarCard}>
              <h2 className={styles.sidebarTitle}>What this means</h2>
              <ul className={styles.commitments}>
                {commitments.map((commitment) => (
                  <li key={commitment}>{renderBrandText(commitment)}</li>
                ))}
              </ul>
            </section>
          </aside>

          <article className={styles.article}>
            <header className={styles.articleHeader}>
              <p className={styles.articleEyebrow}>{sectionEyebrow}</p>
              <h2 className={styles.articleTitle}>{renderBrandText(sectionTitle)}</h2>
              <p className={styles.articleIntro}>{renderBrandText(sectionBody)}</p>
            </header>

            {sections.map((section) => (
              <section key={section.id} id={section.id} className={styles.section}>
                <h3>{renderBrandText(section.title)}</h3>

                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{renderBrandText(paragraph)}</p>)}

                {section.bullets ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{renderBrandText(bullet)}</li>
                    ))}
                  </ul>
                ) : null}

                {section.note ? <p className={styles.sectionNote}>{renderBrandText(section.note)}</p> : null}
              </section>
            ))}

            <div className={styles.bottomActions}>
              <Link className="button" href="/">
                Back to home
              </Link>
              <Link className="button secondary" href={relatedHref}>
                {relatedLabel}
              </Link>
            </div>
          </article>
        </div>
      </div>

      <MarketingFooter />
    </main>
  );
}
