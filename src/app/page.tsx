import Link from "next/link";

import { LandingSceneShell } from "@/components/landing-scene-shell";
import { SendloomLogo } from "@/components/sendloom-logo";

import styles from "@/app/landing.module.css";

const featureCards = [
  {
    index: "01",
    title: "Map once. Personalize everywhere.",
    body:
      "Bring in CSV or XLSX data, lock your field mapping, and turn raw rows into polished subject lines, body copy, and attachments without touching the template again.",
    pills: ["CSV + XLSX", "Field mapping", "Template snapshots"]
  },
  {
    index: "02",
    title: "Stay fast without acting reckless.",
    body:
      "Sendloom keeps suppressions, retries, tracking links, and send-window guardrails in the loop so campaigns feel deliberate even when the list is moving quickly.",
    pills: ["120/min guardrail", "Suppression aware", "Retries + tracking"]
  },
  {
    index: "03",
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
    title: "Choose the message system",
    body: "Pair the list with a template, sender, and attachment strategy that feels intentional instead of one-size-fits-all."
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
    <main className={styles.page}>
      <Link className={styles.sideCta} href="/login">
        Try it
      </Link>

      <div className={styles.frame}>
        <header className={styles.nav}>
          <div className={styles.brand}>
            <SendloomLogo className={styles.brandMark} />
            <div className={styles.brandText}>
              <strong>Sendloom</strong>
              <span>Sequence operations with real sending discipline.</span>
            </div>
          </div>

          <div className={styles.navActions}>
            <a className={styles.navLink} href="#workflow">
              Workflow
            </a>
            <Link className={styles.ghostButton} href="/login">
              Login
            </Link>
            <Link className={styles.primaryButton} href="/login">
              Try it
            </Link>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>Built for founders, operators, and lean GTM teams</div>
            <h1 className={styles.headline}>
              Cold outreach that feels <span className={styles.headlineAccent}>crafted</span>, not sprayed.
            </h1>
            <p className={styles.lede}>
              Sendloom turns your spreadsheet, template, and connected Gmail sender into one clean launch surface. Import lists,
              map fields, add attachments, track runs, and keep suppressions in the same place the sequence actually lives.
            </p>

            <div className={styles.ctaRow}>
              <Link className={styles.primaryButton} href="/login">
                Try it now
              </Link>
              <a className={styles.ghostButton} href="#proof">
                See how it works
              </a>
            </div>

            <div className={styles.statRow}>
              <article className={styles.statCard}>
                <span className={styles.statValue}>120/min</span>
                <span className={styles.statLabel}>Send window guardrail built into the flow</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>Google-native</span>
                <span className={styles.statLabel}>Connected sender profiles instead of throwaway relays</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statValue}>Tracked</span>
                <span className={styles.statLabel}>Opens, clicks, suppressions, and run status in one view</span>
              </article>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.sceneShell}>
              <div className={styles.sceneCanvas}>
                <LandingSceneShell />
              </div>

              <div className={styles.floatingCard}>
                <span className={styles.floatingLabel}>Sequence posture</span>
                <strong className={styles.floatingValue}>High-signal sending</strong>
                <span className={styles.floatingMeta}>Mapped audience, connected sender, attachment-ready template.</span>
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
            <strong>Template intelligence</strong>
            <span>Keep merge variables, attachment snapshots, and subject lines aligned to the same campaign record.</span>
          </article>
          <article className={styles.beltCard}>
            <strong>Respectful sending</strong>
            <span>Suppressions and retry states stay inside the delivery engine, not in a separate afterthought spreadsheet.</span>
          </article>
          <article className={styles.beltCard}>
            <strong>Operator clarity</strong>
            <span>Recent runs, recipient statuses, and connected senders are visible from the same system that launches them.</span>
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
              <Link className={styles.primaryButton} href="/login">
                Try it
              </Link>
              <Link className={styles.ghostButton} href="/setup">
                Review setup
              </Link>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
