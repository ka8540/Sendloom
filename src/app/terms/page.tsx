import { LegalPage } from "@/components/legal-page";

const highlights = [
  {
    label: "Use",
    value: "Lawful only",
    detail: "The service is for responsible outreach and workflow operations, not spam, fraud, or abuse."
  },
  {
    label: "Connected senders",
    value: "Your responsibility",
    detail: "You remain responsible for the messages sent from the Gmail account you connect."
  },
  {
    label: "Enforcement",
    value: "Access can end",
    detail: "Accounts can be suspended or terminated when terms are violated or risk is created."
  },
  {
    label: "Age",
    value: "18+ only",
    detail: "Sendloom is for adults conducting lawful business outreach. Users must be 18 or older."
  }
] as const;

const quickFacts = [
  {
    title: "Account ownership",
    body: "You are responsible for account accuracy, credential security, and activity through your login."
  },
  {
    title: "Acceptable use",
    body: "No spam, phishing, fraud, unauthorized access attempts, or behavior that harms the platform."
  },
  {
    title: "Service changes",
    body: "Features may evolve, improve, or be removed as the product changes over time."
  },
  {
    title: "Termination",
    body: "Access may be suspended or terminated when required by law or when risk to the service appears."
  },
  {
    title: "Age requirement",
    body: "You must be 18 or older to use Sendloom. The service is not intended for minors."
  }
] as const;

const sections = [
  {
    id: "use-of-service",
    title: "Use of the service",
    paragraphs: [
      "Sendloom is provided for lawful outreach, campaign operations, and related workflow management.",
      "You agree to use the service responsibly and in compliance with all applicable laws, regulations, and platform rules."
    ]
  },
  {
    id: "eligibility",
    title: "Eligibility",
    bullets: [
      "You must be 18 years of age or older to create an account or use Sendloom.",
      "By creating an account, you represent that you meet this age requirement.",
      "Sendloom is a business outreach tool and is not intended for children, teens, or minors."
    ]
  },
  {
    id: "accounts",
    title: "Accounts",
    bullets: [
      "You are responsible for the accuracy of the account information you provide.",
      "You are responsible for activity that happens through your account.",
      "You must keep your login credentials and connected accounts secure."
    ]
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    bullets: [
      "You may not use Sendloom for spam, phishing, fraud, or unlawful messaging activity.",
      "You may not attempt to gain unauthorized access to the service or other user accounts.",
      "You may not use the service in a way that harms the platform, its infrastructure, or other users."
    ]
  },
  {
    id: "recipient-data",
    title: "Recipient data and outreach rules",
    bullets: [
      "You must have a lawful basis for the contact lists you upload and use with Sendloom.",
      "You must honor unsubscribe and opt-out requests from recipients.",
      "You must not use Sendloom to contact individuals known or believed to be minors.",
      "Sendloom may restrict or suspend accounts that violate these outreach rules."
    ]
  },
  {
    id: "discover-and-inferred-contacts",
    title: "Discover and inferred contact information",
    bullets: [
      "Discover is provided to help you organize lawful business outreach.",
      "Discover results may include inferred or generated email addresses based on public evidence, company domains, naming patterns, and provider data.",
      "Sendloom does not guarantee that inferred email addresses are accurate, verified, deliverable, current, or appropriate for every use.",
      "You are responsible for verifying results and deciding whether outreach is lawful and appropriate before you send.",
      "You must comply with applicable email, privacy, anti-spam, employment, platform, and data-protection laws.",
      "You may not use Discover for harassment, spam, deception, unlawful profiling, sensitive targeting, or otherwise prohibited outreach.",
      "Sendloom may limit, suspend, or restrict Discover access in response to abuse or policy violations.",
      "Manual reports and issue reports are for product support and safety review, not emergency support."
    ],
    note: "This section is product policy information and not legal advice."
  },
  {
    id: "google-and-connected-email",
    title: "Google and connected email accounts",
    paragraphs: [
      "If you connect a Google account or Gmail sender, you authorize Sendloom to use the granted access only for the functionality you requested inside the product.",
      "You remain responsible for the messages sent from your connected account."
    ]
  },
  {
    id: "your-content-and-data",
    title: "Your content and data",
    paragraphs: [
      "You retain responsibility for the contact lists, templates, uploaded files, and other data you put into Sendloom.",
      "You represent that you have the right to use that content with the service."
    ]
  },
  {
    id: "availability-and-changes",
    title: "Availability and changes",
    paragraphs: [
      "Sendloom may evolve over time. Features may be modified, improved, or removed.",
      "We do not guarantee uninterrupted or error-free availability of the service."
    ]
  },
  {
    id: "termination",
    title: "Termination",
    paragraphs: [
      "We may suspend or terminate access to Sendloom if these terms are violated, if required by law, or if continued access creates risk to the service or other users."
    ]
  },
  {
    id: "disclaimer",
    title: "Disclaimer",
    paragraphs: [
      "Sendloom is provided on an \"as is\" and \"as available\" basis to the fullest extent permitted by law, without warranties of any kind, express or implied."
    ]
  },
  {
    id: "legal-review-notice",
    title: "Legal review notice",
    paragraphs: [
      "These terms are provided for transparency and operational guidance. They should be reviewed by qualified legal counsel before reliance in any regulated context."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: ["If you have questions about these terms, contact Sendloom at ka8540@g.rit.edu."]
  }
] as const;

export default function TermsPage() {
  return (
    <LegalPage
      commitments={[
        "Use the service for lawful outreach and real workflow operations.",
        "Keep control of your login and any connected sender accounts.",
        "Expect platform protections when activity puts the service or other users at risk.",
        "Comply with the Anti-Abuse Policy when conducting outreach."
      ]}
      description="These Terms of Service govern your use of Sendloom and outline the responsibilities that come with account access, connected senders, and lawful outreach activity."
      eyebrow="Service boundaries"
      guideBody="This version keeps the substance of the original terms intact, but organizes the reading path around the questions operators usually have before they connect a sender or launch outreach."
      guideTitle="The quick read"
      highlights={highlights}
      lastUpdated="July 8, 2026"
      quickFacts={quickFacts}
      relatedHref="/privacy"
      relatedLabel="Read privacy policy"
      sectionBody="The sections below cover the major operating boundaries: lawful use, account responsibility, sender responsibility, product changes, suspension, and the standard service disclaimer."
      sectionEyebrow="Terms details"
      sectionTitle="How Sendloom can be used and where responsibility stays."
      sections={sections}
      title="Terms of Service"
    />
  );
}
