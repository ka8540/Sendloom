import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <section className="card legal-card">
        <header className="legal-header">
          <span className="legal-meta">Last updated: March 25, 2026</span>
          <h1>Terms of Service</h1>
          <p className="muted">
            These Terms of Service govern your use of Sendloom. By using the service, you agree to these terms.
          </p>
        </header>

        <section className="legal-section">
          <h2>Use of the service</h2>
          <p>
            Sendloom is provided for lawful outreach, campaign operations, and related workflow management. You agree to use the
            service responsibly and in compliance with all applicable laws, regulations, and platform rules.
          </p>
        </section>

        <section className="legal-section">
          <h2>Accounts</h2>
          <ul>
            <li>You are responsible for the accuracy of the account information you provide.</li>
            <li>You are responsible for activity that happens through your account.</li>
            <li>You must keep your login credentials and connected accounts secure.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Acceptable use</h2>
          <ul>
            <li>You may not use Sendloom for spam, phishing, fraud, or unlawful messaging activity.</li>
            <li>You may not attempt to gain unauthorized access to the service or other user accounts.</li>
            <li>You may not use the service in a way that harms the platform, its infrastructure, or other users.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>Google and connected email accounts</h2>
          <p>
            If you connect a Google account or Gmail sender, you authorize Sendloom to use the granted access only for the
            functionality you requested inside the product. You remain responsible for the messages sent from your connected account.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your content and data</h2>
          <p>
            You retain responsibility for the contact lists, templates, uploaded files, and other data you put into Sendloom. You
            represent that you have the right to use that content with the service.
          </p>
        </section>

        <section className="legal-section">
          <h2>Availability and changes</h2>
          <p>
            Sendloom may evolve over time. Features may be modified, improved, or removed. We do not guarantee uninterrupted or
            error-free availability of the service.
          </p>
        </section>

        <section className="legal-section">
          <h2>Termination</h2>
          <p>
            We may suspend or terminate access to Sendloom if these terms are violated, if required by law, or if continued access
            creates risk to the service or other users.
          </p>
        </section>

        <section className="legal-section">
          <h2>Disclaimer</h2>
          <p>
            Sendloom is provided on an “as is” and “as available” basis to the fullest extent permitted by law, without warranties
            of any kind, express or implied.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>If you have questions about these terms, contact Sendloom at ka8540@g.rit.edu.</p>
        </section>

        <div className="legal-actions">
          <Link className="button" href="/">
            Back to home
          </Link>
          <Link className="button secondary" href="/privacy">
            Read privacy policy
          </Link>
        </div>
      </section>
    </main>
  );
}
