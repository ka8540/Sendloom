import type { Metadata } from "next";
import Link from "next/link";

import { AnimatedEmailPath } from "@/components/AnimatedEmailPath";
import { BrandText, renderBrandText } from "@/components/brand-text";
import { LandingNav } from "@/components/landing-nav";
import { SendloomLogo } from "@/components/sendloom-logo";

import styles from "@/app/landing.module.css";

export const metadata: Metadata = {
  title: "Sendloom - Personalized Gmail Outreach from Spreadsheets",
  description:
    "Launch personalized cold email campaigns from spreadsheets with Gmail sending, templates, AI copy polish, email finding, safe pacing, and campaign tracking."
};

const trustChips = [
  {
    title: "Gmail-connected sending",
    body: "Your connected Gmail account stays the sender."
  },
  {
    title: "Spreadsheet-to-campaign workflow",
    body: "Import CSV/XLSX leads and map fields into templates."
  },
  {
    title: "Built-in safe send pacing",
    body: "Send pacing keeps campaigns controlled."
  }
] as const;

const productFlow = [
  "Import CSV/XLSX",
  "Find emails",
  "Connect Gmail",
  "Map variables",
  "AI subject/body",
  "Launch safely",
  "Track statuses"
] as const;

const statusItems = ["Sent", "Opened", "Clicked", "Replied", "Failed", "Suppressed"] as const;

const outcomeCards = [
  {
    index: "01",
    title: "Stop switching tools",
    body:
      "Move from spreadsheet to Gmail launch without bouncing between Sheets, Gmail, Hunter.io, and a tracking spreadsheet.",
    pills: ["CSV/XLSX imports", "Gmail sending", "Campaign tracking"]
  },
  {
    index: "02",
    title: "Personalize without looking mass-sent",
    body:
      "Map spreadsheet columns into template variables, preview each email, and use AI polish to tighten the subject and body before sending.",
    pills: ["Variable mapping", "Email previews", "AI copy polish"]
  },
  {
    index: "03",
    title: "Launch with safer controls",
    body:
      "Connect Gmail, review suppressions, keep retries visible, and use built-in send pacing to reduce reckless sending.",
    pills: ["Gmail OAuth", "Suppressions", "Controlled pacing"]
  },
  {
    index: "04",
    title: "Know what happened",
    body:
      "See campaign run status for sent, failed, opened, clicked, replied, suppressed, and retry states from the same workspace.",
    pills: ["Run status", "Open/click/reply", "Retry visibility"]
  }
] as const;

const workflowSteps = [
  {
    title: "Import your audience",
    body: "Upload CSV/XLSX and map spreadsheet columns to template variables."
  },
  {
    title: "Find or enrich emails",
    body: "Use your connected Hunter.io key to find professional email addresses when needed."
  },
  {
    title: "Write and polish your message",
    body: "Create a template, preview each personalized email, and optionally use AI to improve the copy."
  },
  {
    title: "Connect Gmail and launch safely",
    body: "Send through your connected Gmail account with pacing, suppressions, and retry visibility."
  },
  {
    title: "Track every campaign run",
    body: "See delivery status, opens, clicks, replies, failures, and suppressed contacts."
  }
] as const;

const trustCards = [
  {
    title: "Your Gmail stays the sender",
    body: "Sendloom uses Gmail OAuth so campaigns send through the mailbox you connect."
  },
  {
    title: "Preview before launch",
    body: "Review mapped variables and personalized message previews before a campaign run starts."
  },
  {
    title: "Suppression-aware sending",
    body: "Suppressions and retries stay visible, so launches are easier to control."
  },
  {
    title: "Bring your Hunter.io key",
    body: "Email finding uses the Hunter.io API key you provide instead of hiding enrichment in another workflow."
  }
] as const;

export default function LandingPage() {
  return (
    <main id="top" className={styles.page}>
      <AnimatedEmailPath />
      <div className={styles.frame}>
        <LandingNav />

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>For founders, solo operators, and small GTM teams</div>
            <h1 className={styles.headline}>
              Cold outreach that feels <span className={styles.headlineAccent}>crafted</span>, not sprayed.
            </h1>
            <p className={styles.lede}>
              <BrandText>Sendloom</BrandText> helps founders and operators launch personalized Gmail outreach from a spreadsheet,
              with templates, email finding, AI polish, safe send pacing, and live campaign tracking in one clean workflow.
            </p>

            <div className={styles.ctaRow}>
              <Link className={styles.primaryButton} href="/signup">
                Start your first campaign
              </Link>
              <a className={styles.ghostButton} href="#workflow">
                See how it works
              </a>
            </div>

            <div className={styles.statRow}>
              {trustChips.map((chip) => (
                <article key={chip.title} className={styles.statCard}>
                  <span className={styles.statValue}>{chip.title}</span>
                  <span className={styles.statLabel}>{chip.body}</span>
                </article>
              ))}
            </div>
          </div>

          <div className={styles.heroVisual}>
            <article className={styles.productMockup} aria-label="Sendloom campaign workflow preview">
              <div className={styles.mockHeader}>
                <div>
                  <span className={styles.mockKicker}>Campaign workspace</span>
                  <strong>Personalized Gmail launch</strong>
                </div>
                <span className={styles.mockStatus}>Preview ready</span>
              </div>

              <div className={styles.mockGrid}>
                <section className={styles.mockPanel}>
                  <div className={styles.mockPanelHeader}>
                    <span>Workflow</span>
                    <strong>7 checks</strong>
                  </div>
                  <div className={styles.flowList}>
                    {productFlow.map((item, index) => (
                      <div key={item} className={styles.flowItem}>
                        <span className={styles.flowIndex}>{index + 1}</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.mockPanel}>
                  <div className={styles.mockPanelHeader}>
                    <span>Template preview</span>
                    <strong>Variables mapped</strong>
                  </div>
                  <div className={styles.templatePreview}>
                    <span className={styles.subjectLine}>Subject: quick idea for {"{{company}}"}</span>
                    <p>
                      Hi {"{{first_name}}"}, I noticed {"{{company}}"} is hiring for GTM roles. Here is a short,
                      personalized note ready for review before launch.
                    </p>
                    <div className={styles.variableGrid}>
                      <span>{"{{first_name}}"}</span>
                      <span>{"{{company}}"}</span>
                      <span>{"{{role}}"}</span>
                    </div>
                  </div>
                </section>

                <section className={styles.mockPanel}>
                  <div className={styles.mockPanelHeader}>
                    <span>Launch controls</span>
                    <strong>Controlled send</strong>
                  </div>
                  <div className={styles.controlList}>
                    <span>Gmail connected</span>
                    <span>Safe pacing enabled</span>
                    <span>Suppressions checked</span>
                    <span>Retries visible</span>
                  </div>
                </section>

                <section className={styles.mockPanel}>
                  <div className={styles.mockPanelHeader}>
                    <span>Run visibility</span>
                    <strong>Live statuses</strong>
                  </div>
                  <div className={styles.statusGrid}>
                    {statusItems.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </section>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.section} id="outcomes">
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Outcomes</p>
            <h2 className={styles.sectionTitle}>One workflow for the parts of outreach that usually drift apart.</h2>
            <p className={styles.sectionText}>
              Sendloom keeps the list, message, sender, controls, and run history together so a small team can launch with more
              confidence and less tool-switching.
            </p>
          </div>

          <div className={styles.featureGrid}>
            {outcomeCards.map((feature) => (
              <article key={feature.index} className={styles.featureCard}>
                <span className={styles.featureIndex}>{feature.index}</span>
                <h3>{feature.title}</h3>
                <p>{renderBrandText(feature.body)}</p>
                <div className={styles.featurePills}>
                  {feature.pills.map((pill) => (
                    <span key={pill}>{pill}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} id="workflow">
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>How Sendloom works</p>
            <h2 className={styles.sectionTitle}>From spreadsheet to tracked Gmail campaign in five steps.</h2>
          </div>

          <div className={styles.workflow}>
            <article className={styles.workflowPanel}>
              <h3>Built for the person shipping the campaign.</h3>
              <p>
                Import the audience, enrich missing emails, polish the message, connect Gmail, and launch with the controls in view.
              </p>
              <p>
                Send pacing keeps campaigns controlled and prevents reckless launches. If the exact per-user send window appears in
                the app, it is there as a control mechanism, not a volume promise.
              </p>
            </article>

            <div className={styles.workflowStack}>
              {workflowSteps.map((step, index) => (
                <article key={step.title} className={styles.step}>
                  <span className={styles.stepNumber}>0{index + 1}</span>
                  <div>
                    <h4>{step.title}</h4>
                    <p>{step.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="proof">
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Trust</p>
            <h2 className={styles.sectionTitle}>Built for real outreach workflows.</h2>
            <p className={styles.sectionText}>
              No fake logos, no inflated claims. Just practical controls for founders, solo operators, and small GTM teams that need
              cleaner campaign operations.
            </p>
          </div>

          <div className={styles.trustGrid}>
            {trustCards.map((card) => (
              <article key={card.title} className={styles.trustCard}>
                <strong>{card.title}</strong>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.ctaSection}>
          <article className={styles.ctaPanel}>
            <h2>Launch cleaner outreach without duct-taping five tools together.</h2>
            <p>
              Import leads, personalize messages, send through Gmail, and track every campaign run from one workspace.
            </p>

            <div className={styles.ctaActions}>
              <Link className={styles.primaryButton} href="/signup">
                Start your first campaign
              </Link>
              <a className={styles.ghostButton} href="#workflow">
                See how it works
              </a>
            </div>
          </article>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrandBlock}>
              <div className={styles.footerBrand}>
                <SendloomLogo className={styles.footerBrandMark} />
                <div>
                  <strong>
                    <BrandText>Sendloom</BrandText>
                  </strong>
                  <span>Outreach operations with one source of truth.</span>
                </div>
              </div>
              <p className={styles.footerCopy}>
                Built for small teams who want imports, templates, sender setup, launch controls, and run visibility in one workspace.
              </p>
            </div>

            <div className={styles.footerColumns}>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Product</span>
                <a href="#workflow">Workflow</a>
                <a href="#outcomes">Outcomes</a>
                <Link href="/signup">
                  Start your first campaign
                </Link>
              </div>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Access</span>
                <Link href="/login">Login</Link>
                <Link href="/signup">Create account</Link>
                <Link href="/workspace">Dashboard</Link>
              </div>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Legal</span>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
                <a href="mailto:hello@sendloom.net">Contact</a>
              </div>
            </div>
          </div>

          <div className={styles.footerBottom}>
            <span>
              <BrandText>Sendloom</BrandText>.net
            </span>
            <div className={styles.footerLinks}>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/login">Login</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
