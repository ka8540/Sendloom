import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <section className="card legal-card">
        <header className="legal-header">
          <span className="legal-meta">Last updated: March 25, 2026</span>
          <h1>Privacy Policy</h1>
          <p className="muted">
            This Privacy Policy explains what information Sendloom collects, how we use it, and how you can manage your data when
            you use the product.
          </p>
        </header>

        <section className="legal-section">
          <h2>What Sendloom does</h2>
          <p>
            Sendloom helps users upload contact lists, create templates, connect a Gmail account, and run outreach sequences from a
            single dashboard.
          </p>
        </section>

        <section className="legal-section">
          <h2>Information we collect</h2>
          <ul>
            <li>Account information such as your email address and sign-in method.</li>
            <li>Google profile information such as your name, email address, and profile image when you sign in with Google.</li>
            <li>Connected Gmail account information needed to send email on your behalf after you explicitly authorize it.</li>
            <li>Templates, imports, uploaded files, mappings, sender profiles, campaigns, and suppression records that you create inside Sendloom.</li>
            <li>Usage and operational data needed to keep the service secure, reliable, and functioning correctly.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>How we use Google user data</h2>
          <ul>
            <li>To sign you into your Sendloom account when you choose Google sign-in.</li>
            <li>To connect a Gmail sender that you choose and send emails from that account inside the product.</li>
            <li>To store the minimum Google account details needed to identify the connected sender and maintain your session.</li>
          </ul>
          <p>
            Sendloom does not use Google user data for advertising, does not sell Google user data, and does not use Google user
            data to train generalized AI or machine learning models.
          </p>
        </section>

        <section className="legal-section">
          <h2>How we use your information</h2>
          <ul>
            <li>To create and manage your account.</li>
            <li>To authenticate you and maintain a secure login session.</li>
            <li>To let you create templates, upload lists, connect senders, and launch sequences.</li>
            <li>To process email delivery activity, track statuses, and apply suppressions.</li>
            <li>To protect the service against abuse, unauthorized access, and operational failures.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>How data is stored and retained</h2>
          <p>
            Sendloom stores account data, templates, campaign records, sender profile details, and imported audience data in the
            application database and related service infrastructure. We retain information for as long as it is needed to operate
            your account, comply with legal obligations, resolve disputes, and enforce our agreements.
          </p>
        </section>

        <section className="legal-section">
          <h2>How data is shared</h2>
          <p>
            Sendloom shares data only with service providers and infrastructure partners needed to operate the app, such as
            authentication, hosting, database, storage, and email-related services. We do not sell your personal information.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your choices</h2>
          <ul>
            <li>You can stop using Sendloom at any time.</li>
            <li>You can disconnect Google access from your Google account permissions page.</li>
            <li>You can request deletion of your account data by contacting us.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Security</h2>
          <p>
            We use reasonable administrative, technical, and organizational safeguards designed to protect your information.
            However, no system can be guaranteed to be completely secure.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>If you have privacy questions or data requests, contact Sendloom at ka8540@g.rit.edu.</p>
        </section>

        <div className="legal-actions">
          <Link className="button" href="/">
            Back to home
          </Link>
          <Link className="button secondary" href="/terms">
            Read terms
          </Link>
        </div>
      </section>
    </main>
  );
}
