import Link from "next/link";

import { AnimatedEmailPath } from "@/components/AnimatedEmailPath";
import { LandingSceneShell } from "@/components/landing-scene-shell";
import { LandingNav } from "@/components/landing-nav";
import { SendloomLogo } from "@/components/sendloom-logo";

import styles from "@/app/landing.module.css";

const featureCards = [
  {
    index: "01",
    title: "Write in the format your team actually wants.",
    body:
      "Switch between plain text, HTML, and structured JSON inside the same template editor. Sendloom renders each one into a clean email preview while keeping merge variables and inline AI help intact.",
    pills: ["Plain text", "HTML", "Structured JSON"]
  },
  {
    index: "02",
    title: "Find the right inbox before you launch.",
    body:
      "Run name-plus-domain lookups or domain-wide searches from the same dashboard, then plug your own API key from hunter.io into Sendloom so the finder stays inside your workflow instead of becoming another tab.",
    pills: ["Find Email", "Domain Search", "Bring your own API key"]
  },
  {
    index: "03",
    title: "Stay fast without acting reckless.",
    body:
      "Sendloom keeps suppressions, retries, tracking links, and send-window guardrails in the loop so campaigns feel deliberate even when the list is moving quickly.",
    pills: ["120/min per user", "Suppression aware", "Retries + tracking"]
  },
  {
    index: "04",
    title: "Launch from a connected Gmail sender.",
    body:
      "Use the mailbox you already trust, connect Google in minutes, and move from upload to launch with a single operator dashboard instead of five disconnected tools.",
    pills: ["Google OAuth", "Sender profiles", "Live run status"]
  }
] as const;

const workflowSteps = [
  {
    title: "Import your audience",
    body: "Upload a spreadsheet, detect columns instantly, and keep the row data structured for every downstream send."
  },
  {
    title: "Find missing emails when the list is incomplete",
    body: "Use name-plus-domain lookups or domain search with your own API key from hunter.io, then keep those results inside the same operator flow."
  },
  {
    title: "Choose the message system",
    body: "Pair the list with a template, sender, and attachment strategy, then write in plain text, HTML, or JSON with inline AI help before you save."
  },
  {
    title: "Launch and watch the run",
    body: "Immediate sequences begin processing from the app itself, and status updates stay visible while the run moves."
  },
  {
    title: "Keep the sequence honest",
    body: "Clicks, opens, suppressions, and retry states stay attached to the campaign so your next send starts smarter."
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
            <div className={styles.eyebrow}>Built for founders, operators, and lean GTM teams</div>
            <h1 className={styles.headline}>
              Cold outreach that feels <span className={styles.headlineAccent}>crafted</span>, not sprayed.
            </h1>
            <p className={styles.lede}>
              Sendloom turns your spreadsheet, template, and connected Gmail sender into one clean launch surface. Import lists,
              map fields, find missing contact emails with your own API key from hunter.io, choose plain text, HTML, or structured
              JSON templates, enhance subject lines and email copy with AI, add attachments, track runs, and keep suppressions in
              the same place the sequence actually lives.
            </p>

            <div className={styles.ctaRow}>
              <Link className={styles.primaryButton} href="/signup">
                Try it now
              </Link>
              <a className={styles.ghostButton} href="#proof">
                See how it works
              </a>
            </div>

            <div className={styles.statRow}>
              <article className={styles.statCard}>
                <span className={styles.statValue}>120/min/user</span>
                <span className={styles.statLabel}>Per-user send window guardrail built into the flow</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>Finder-ready</span>
                <span className={styles.statLabel}>Use your own hunter.io API key for name and domain lookups without leaving the dashboard</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>3 formats</span>
                <span className={styles.statLabel}>Write templates in plain text, HTML, or JSON and preview them as real email</span>
              </article>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.sceneShell}>
              <div className={styles.sceneCanvas}>
                <LandingSceneShell />
              </div>

              <div className={styles.floatingCard}>
                <span className={styles.floatingLabel}>Template polish</span>
                <strong className={styles.floatingValue}>Plain text, HTML, or JSON</strong>
                <span className={styles.floatingMeta}>Use the format that fits the workflow, then preview it like a real email instead of raw markup.</span>
              </div>

              <div className={styles.floatingCardAlt}>
                <span className={styles.floatingLabel}>Live controls</span>
                <strong className={styles.floatingValue}>Imports → templates → launch</strong>
                <span className={styles.floatingMeta}>One operator surface instead of tabs stitched together by memory.</span>
              </div>

              <div className={styles.floatingCardLower}>
                <span className={styles.floatingLabel}>Run visibility</span>
                <strong className={styles.floatingValue}>Suppression-aware</strong>
                <span className={styles.floatingMeta}>Status, retries, opens, and clicks stay attached to the campaign.</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.belt} id="proof">
          <article className={styles.beltCard}>
            <strong>Audience imports</strong>
            <span>Bring in CSV and XLSX files without rebuilding your workflow every time the list changes.</span>
          </article>
          <article className={styles.beltCard}>
            <strong>Email finder</strong>
            <span>Bring your own API key from hunter.io and run name or domain lookups inside the same workspace.</span>
          </article>
          <article className={styles.beltCard}>
            <strong>Template intelligence</strong>
            <span>Keep merge variables, AI-polished copy, format choice, attachment snapshots, and subject lines aligned to the same template record.</span>
          </article>
          <article className={styles.beltCard}>
            <strong>Respectful sending</strong>
            <span>Suppressions and retry states stay inside the delivery engine, not in a separate afterthought spreadsheet.</span>
          </article>
          <article className={styles.beltCard}>
            <strong>Operator clarity</strong>
            <span>Recent runs, recipient statuses, finder results, and connected senders are visible from the same system that launches them.</span>
          </article>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Why it feels different</p>
            <h2 className={styles.sectionTitle}>A launch surface designed for signal, not volume theater.</h2>
            <p className={styles.sectionText}>
              Great outreach products don’t just blast faster. They help small teams stay precise while the audience, message, and
              sender all change underneath them. Sendloom was shaped around that operator reality.
            </p>
          </div>

          <div className={styles.featureGrid}>
            {featureCards.map((feature) => (
              <article key={feature.index} className={styles.featureCard}>
                <span className={styles.featureIndex}>{feature.index}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
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
            <p className={styles.sectionEyebrow}>Workflow</p>
            <h2 className={styles.sectionTitle}>From raw list to a live sequence, without the usual glue work.</h2>
          </div>

          <div className={styles.workflow}>
            <article className={styles.workflowPanel}>
              <h3>Built for the person actually shipping the campaign.</h3>
              <p>
                If you’re the one importing leads, checking the sender, fixing the template, and watching the run at the same time,
                the interface should help you think clearly. That’s the bar this product is trying to hit.
              </p>
              <p>
                The page layout, delivery primitives, and tracking model are all there to reduce hesitation at launch time and make
                the sequence easier to trust afterward.
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

        <section className={styles.ctaSection}>
          <article className={styles.ctaPanel}>
            <h2>Walk in with a spreadsheet. Walk out with a running sequence.</h2>
            <p>
              Connect Gmail, create the campaign, and start testing the full flow from a single login. The fastest way to understand
              Sendloom is to put your own list through it.
            </p>

            <div className={styles.ctaActions}>
              <Link className={styles.primaryButton} href="/signup">
                Try it
              </Link>
              <a className={styles.ghostButton} href="#workflow">
                See workflow
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
                  <strong>Sendloom</strong>
                  <span>Outreach operations with one source of truth.</span>
                </div>
              </div>
              <p className={styles.footerCopy}>
                Built for small teams who want imports, templates, sender setup, launch, and run visibility in one calm system.
              </p>
            </div>

            <div className={styles.footerColumns}>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Product</span>
                <a href="#workflow">Workflow</a>
                <a href="#proof">Why it works</a>
                <Link href="/signup">Try Sendloom</Link>
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
            <span>Sendloom.net</span>
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
